'use strict';

const fs = require('fs');
const URL = require('url');
const path = require('path');
const fse = require('fs-extra');
const semver = require('semver');
const logger = require('../logger');
const Metadata = require('../metadata');
const Dictionary = require('../dictionary');
const Downloader = require('../downloader');
const { execSync } = require('child_process');
const { config, fetch } = require('../../parameters');
const { extend, spawner, homePath } = require('../util');

class Terraform {
  /**
   * @param {Object} config
   */
  constructor(config) {
    this._config = extend({}, [this._defaults(), config]);
    this._tf = this._config.terraform;
    this._envVars = process.env;
    this._metadata = new Metadata(this._config);

    this._showLogs = !process.env.format;
    this._isWorkspaceSupported = false;
  }

  /**
   * @return {Object}
   * @private
   */
  _defaults() {
    return {
      terraform: {
        var: {},
        varFile: [],
        backend: {},
        version: '0.11.11',
        backup: false,
        workspace: 'default'
      }
    };
  }

  /**
   * Terraform module name
   * @return {String}
   */
  getName() {
    return this._config.name || this._config.root;
  }

  /**
   * @return {String}
   */
  getVersion() {
    if (!semver.valid(this._tf.version)) {
      throw new Error(`Terraform version ${this._tf.version} is invalid`);
    }

    return this._tf.version;
  }

  /**
   * @return {String}
   */
  getBinary() {
    return homePath('terraform', this.getVersion(), 'terraform');
  }

  /**
   * Prepare -var
   * @return {Array}
   * @private
   */
  _var() {
    return Object.keys(this._tf.var).map(name => `-var='${name}=${this._tf.var[name]}'`);
  }

  /**
   * Prepare -backend-config
   * @return {Array}
   * @private
   */
  _backend() {
    return Object.keys(this._tf.backend).map(name => `-backend-config='${name}=${this._tf.backend[name]}'`);
  }

  /**
   * Prepare -var-file
   * @return {Array}
   * @private
   */
  _varFile() {
    const result = [];

    this._tf.varFile.forEach(fileName => {
      const varFile = path.join(this._metadata.getRoot(), fileName);

      if (fs.existsSync(varFile)) {
        result.push(`-var-file='${varFile}'`);
      }
    });

    return result;
  }

  /**
   * Perform terraform init & all required checks
   * @return {Promise}
   */
  prepare() {
    logger.debug(JSON.stringify(this._config, null, 2));

    return this._checkTerraformBinary()
      .then(() => this._checkWorkspaceSupport())
      .then(() => this._checkResourceDir())
      .then(() => this._fetchEnvironmentVariables())
      .then(() => ({ status: Dictionary.REALTIME.SUCCESS }));
  }

  /**
   * Fetch environment variables from api
   * @return {Promise}
   */
  _fetchEnvironmentVariables() {
    return this._getEnvVarsFromAPI().then(data => {
      return Object.assign(this._envVars, data);
    });
  }

  /**
   * Ensure binary exists (download otherwise)
   * @return {Promise}
   */
  _checkTerraformBinary() {
    if (fs.existsSync(this.getBinary())) {
      return Promise.resolve();
    }

    return (new Downloader()).download(this.getVersion());
  }

  /**
   * @return {Promise}
   * @private
   */
  _checkResourceDir() {
    return fse.ensureDir(this._metadata.getRoot());
  }

  /**
   * Check if workspaces supported
   * @private
   */
  _checkWorkspaceSupport() {
    this._isWorkspaceSupported = semver.satisfies(this.getVersion(), '>=0.9.0');
  }

  /**
   * Re-init State & Plan paths
   * @note required after workspace & remote state
   * @return {Promise}
   * @private
   */
  _reInitPaths() {
    this._metadata.init();

    return Promise.resolve();
  }

  /**
   * https://www.terraform.io/docs/commands/init.html
   * @return {Promise}
   */
  init() {
    return this.run(
      'init', ['-no-color', '-force-copy', this._optsToArgs({ '-input': false }), ...this._backend(), '.']
    )
      .then(() => this._reInitPaths())
      .then(() => ({ status: Dictionary.REALTIME.SUCCESS }));
  }

  /**
   * https://www.terraform.io/docs/commands/state/pull.html
   * @return {Promise}
   */
  statePull() {
    this._showLogs = false;

    return this.run('state', ['pull', '-no-color']).then(result => {
      this._showLogs = true;
      const backupPath = this._metadata.getStateBackupPath();
      const pullStateContent = JSON.parse(result.toString());

      return fse.ensureFile(backupPath)
        .then(() => fse.writeJson(backupPath, pullStateContent))
        .then(() => JSON.stringify(pullStateContent));
    });
  }

  /**
   * https://www.terraform.io/docs/commands/output.html
   * @return {Promise}
   */
  output() {
    const options = {};

    return this.run('output', (process.env.format === 'json' ? ['-json'] : []).concat(this._optsToArgs(options)))
      .then(buffer => ({ buffer: buffer }));
  }

  /**
   * https://www.terraform.io/docs/commands/workspace/select.html
   * @return {Promise}
   */
  workspaceSelect() {
    if (!this._isWorkspaceSupported) {
      return Promise.resolve();
    }
    const workspace = this._tf.workspace;

    return this.run('workspace', ['list'])
      .then(result => {
        const regexSelected = new RegExp(`\\*\\s${workspace}$`, 'm');
        const regexExists = new RegExp(`\\s${workspace}$`, 'm');
        const output = result.toString();

        return regexSelected.test(output) ?
          Promise.resolve({ status: Dictionary.REALTIME.SKIP }) :
          this.run('workspace', [regexExists.test(output) ? 'select' : 'new', workspace])
            .then(() => Promise.resolve({ status: Dictionary.REALTIME.SUCCESS }));
      })
      .then(res => this._reInitPaths().then(() => Promise.resolve(res)));
  }

  /**
   * https://www.terraform.io/docs/commands/workspace/delete.html
   * @return {Promise}
   */
  workspaceDelete() {
    if (!this._isWorkspaceSupported) {
      return Promise.resolve();
    }

    return this
      .run('workspace', ['select', 'default'])
      .then(() => this.run('workspace', ['delete', this._tf.workspace]));
  }

  /**
   * https://www.terraform.io/docs/commands/workspace/list.html
   * @return {Promise}
   */
  workspaceList() {
    this._showLogs = false;
    return this.run('workspace', ['list']).then(buffer => {
      const workspaces = buffer.toString().match(/[a-z]+/gm);
      const activeWorkspace = buffer.toString().match(/\*\s([a-z]+)/m)[1];

      return {
        activeWorkspace: activeWorkspace,
        workspaces: workspaces
      };
    });
  }

  /**
   * https://www.terraform.io/docs/commands/plan.html
   * @return {Promise}
   */
  plan() {
    const options = { '-out': this._metadata.getPlanPath(), '-input': false };
    const args = process.env.planDestroy === 'true' ? ['-no-color', '-destroy'] : ['-no-color'];

    return this.run('plan', args.concat(this._varFile(), this._var(), this._optsToArgs(options)))
      .then(buffer => {
        const metadata = {};
        const regex = /\s*Plan: ([0-9]+) to add, ([0-9]+) to change, ([0-9]+) to destroy\./;
        const planData = buffer.toString().match(regex);

        let skip = false;
        if (planData) {
          const planCounter = planData.slice(-3);
          ['add', 'change', 'destroy'].forEach((field, index) => { metadata[field] = planCounter[index]; });
        } else {
          ['add', 'change', 'destroy'].forEach((field) => { metadata[field] = '0'; });
          skip = true;
        }

        const planPath = this._metadata.getPlanPath();

        if (fse.existsSync(planPath)) {
          const backupPath = this._metadata.getPlanBackupPath();
          const planContent = fse.readFileSync(planPath).toString();

          fse.outputFileSync(backupPath, planContent);
        }

        return Promise.resolve({
          buffer: buffer,
          skip: skip,
          metadata: metadata,
          status: Dictionary.REALTIME.SUCCESS
        });
      });
  }

  /**
   * https://www.terraform.io/docs/commands/import.html
   * @return {Promise}
   */
  import() {
    const options = { '-input': false };
    const args = ['-no-color'];
    const values = [process.env.resourceName, process.env.importId];
    return this.run('import', args.concat(this._varFile(), this._var(), this._optsToArgs(options),
      values));
  }

  /**
   * https://www.terraform.io/docs/commands/apply.html
   * @return {Promise}
   */
  apply() {
    const options = { '-backup': this._metadata.getStateBackupPath(), '-auto-approve': true, '-input': false };

    return this.run('apply', ['-no-color'].concat(this._optsToArgs(options), this._metadata.getPlanPath()))
      .then(() => this._getStateContent())
      .then(buffer => ({ buffer: buffer, status: Dictionary.REALTIME.SUCCESS }));
  }

  /**
   * Get state content whether is remote or local
   * @return {Promise}
   * @private
   */
  _getStateContent() {
    if (this._metadata.isRemote()) {
      return this.statePull();
    }

    return fse.readFile(this._metadata.getStatePath());
  }

  /**
   * https://www.terraform.io/docs/commands/destroy.html
   * @return {Promise}
   */
  destroy() { return this.apply(); }

  /**
   * https://www.terraform.io/docs/commands/refresh.html
   * @return {Promise}
   */
  refresh() {
    const options = { '-backup': this._metadata.getStateBackupPath(), '-input': false };

    return this
      .run('refresh', ['-no-color'].concat(this._optsToArgs(options), this._varFile(), this._var()));
  }

  /**
   * https://www.terraform.io/docs/commands/show.html
   * @param {String} planOrStatePath
   * @return {Promise}
   */
  show(planOrStatePath) {
    return this.run('show', ['-no-color', planOrStatePath]);
  }

  /**
   * Run terraform command
   * @param {String} cmd
   * @param {Array} args
   * @return {Promise}
   */
  run(cmd, args) {
    if (this._showLogs) {
      logger.warn(`[${this.getName()}] terraform ${cmd} ${args.join(' ')}`);
    }
    return this._spawn(this.getBinary(), [cmd, ...args], {
      cwd: this._metadata.getRoot(),
      env: this._envVars,
      shell: true
    });
  }

  /**
   * Transform options into arguments
   * @param {Object} options
   * @return {Array}
   * @private
   */
  _optsToArgs(options) {
    const args = [];

    Object.keys(options).forEach(key => {
      args.push(`${key}=${options[key]}`);
    });

    return args;
  }

  /**
   * Handle a spawn
   * @param {String} command
   * @param {Array} args
   * @param {Object} options
   * @return {Promise}
   * @private
   */
  _spawn(command, args, options) {
    return spawner(
      command, args, options,
      err => logger.error(this._out(err)),
      data => {
        if (this._showLogs) {
          console.log(data.constructor.name);
          logger.raw(this._out(data));
        }
      }
    );
  }

  /**
   * @param {Buffer} data
   * @return {String}
   * @private
   */
  _out(data) {
    return `[${this.getName()}] ${data.toString()}`;
  }

  /**
   * Get Resources from TerraHub API
   * @return {Promise|*}
   */
  _getEnvVarsFromAPI() {
    if (!config.token) {
      return Promise.resolve({});
    }
    try {
      const urlGet = execSync('git remote get-url origin', { cwd: this._config.project.root, stdio: 'pipe' });
      const data = Buffer.from(urlGet).toString('utf-8');
      const isUrl = !!URL.parse(data).host;
      // works for gitlab/github/bitbucket, add azure, google, amazon
      const urlData = /\/\/(?:.*@)?([^.]+).*?\/([^.]*)/;
      const sshData = /@([^.]*).*:(.*).*(?=\.)/;

      const [, provider, repo] = isUrl ? data.match(urlData) : data.match(sshData);
      if (repo && provider) {
        return fetch.get(`thub/variables/retrieve?repoName=${repo}&source=${provider}`).then(json => {
          if (Object.keys(json.data).length) {
            let test = JSON.parse(json.data.env_var);
            return Object.keys(test).reduce((acc, key) => {
              acc[key] = test[key].value;
              return acc;
            }, {});
          }
        }).catch(() => Promise.resolve({}));
      } else {
        return Promise.resolve({});
      }
    } catch (err) {
      return Promise.resolve({});
    }
  }
}

module.exports = Terraform;
