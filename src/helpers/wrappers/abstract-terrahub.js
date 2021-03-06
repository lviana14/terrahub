'use strict';

const path = require('path');
const logger = require('../logger');
const Terraform = require('./terraform');
const Dictionary = require('../dictionary');
const { config } = require('../../parameters');
const ConfigLoader = require('../../config-loader');
const { promiseSeries, spawner, exponentialBackoff } = require('../util');

class AbstractTerrahub {
  /**
   * @param {Object} cfg
   * @param {String} thubRunId
   */
  constructor(cfg, thubRunId) {
    this._runId = thubRunId;
    this._action = '';
    this._config = cfg;
    this._project = cfg.project;
    this._terraform = new Terraform(cfg);
    this._timestamp = Math.floor(Date.now() / 1000).toString();
    this._componentHash = ConfigLoader.buildComponentHash(this._config.root);
  }

  /**
   * @param {Object} data
   * @param {Error|String} err
   * @return {Promise}
   * @protected
   * @abstract
   */
  on(data, err = null) {
    throw new Error(`Implement 'on' method...`);
  }

  /**
   * Compose terrahub task
   * @param {String} action
   * @param {Object} options
   * @return {Promise}
   */
  getTask(action, options) {
    this._action = action;

    return Promise.resolve().then(() => {
      if (!['init', 'workspaceSelect', 'plan', 'apply', 'destroy'].includes(this._action)) {
        return this._runTerraformCommand(action).catch(err => console.log(err));
      }

      if (options.skip) {
        return this.on({ status: Dictionary.REALTIME.SKIP })
          .then(res => {
            logger.warn(`Action '${this._action}' for '${this._config.name}' was skipped due to ` +
              `'No changes. Infrastructure is up-to-date.'`);
            return res;
          });
      } else {
        return this._getTask();
      }
    }).then(data => {
      data.action = this._action;
      data.component = this._config.name;

      return data;
    });
  }

  /**
   * Check if custom hook is provided
   * @param {String} hook
   * @param {Object} res
   * @return {Promise}
   * @private
   */
  _hook(hook, res = {}) {
    if (['abort', 'skip'].includes(res.status)) {
      return Promise.resolve(res);
    }

    let hookPath;
    try {
      hookPath = this._config.hook[this._action][hook];
    } catch (error) {
      return Promise.resolve(res);
    }

    if (!hookPath) {
      return Promise.resolve(res);
    }

    if (this._config && this._config.hook.env) {
      Object.assign(process.env, this._config.hook.env.variables);
    }

    const commandsList = Array.isArray(hookPath) ? hookPath : [hookPath];

    return promiseSeries(commandsList.map(it => {
      const args = it.split(' ');
      const extension = path.extname(args[0]);

      // If the first arg is a script file get its absolute path
      if (extension) {
        args[0] = path.resolve(this._project.root, this._config.root, args[0]);
      }

      logger.warn(this._addNameToMessage(`Executing hook '${it}' ${hook} ${this._action} action.`));
      let command;
      switch (extension) {
        case '.js':
          return () => {
            const promise = require(args[0])(this._config, res.buffer); // eslint-disable-line global-require

            return (promise instanceof Promise ? promise : Promise.resolve()).then(() => Promise.resolve(res));
          };

        case '.sh':
          command = 'bash';
          break;

        default:
          command = args.shift();
          break;
      }

      return () => this._spawn(command, args, { env: process.env }).then(() => Promise.resolve(res));
    })).catch(error => {
      let originalMessage;

      ['message', 'stderr'].find(key => {
        if (!error[key]) {
          return false;
        }

        const trimmed = error[key].toString().trim();
        if (!trimmed) {
          return false;
        }

        originalMessage = trimmed;
        return true;
      });

      error.message = this._addNameToMessage(originalMessage ?
        `An error occurred in hook ${this._action} ${hook} execution: ${originalMessage}` :
        `An unknown error occurred in hook ${this._action} ${hook} execution.`
      );

      return Promise.reject(error);
    });
  }

  /**
   * @param {String} command
   * @return {Promise}
   * @private
   */
  _runTerraformCommand(command) {
    return exponentialBackoff(() => this._terraform[command](), {
      conditionFunction: error => {
        return [/timeout/, /connection reset by peer/, /failed to decode/, /EOF/].some(it => it.test(error.message));
      },
      maxRetries: config.retryCount,
      intermediateAction: (retries, maxRetries) => {
        logger.warn(this._addNameToMessage(`'${this._action}' failed. ` +
          `Retrying using exponential backoff approach (${retries} out of ${maxRetries}).`));
      }
    });
  }

  /**
   * @param {String} binary
   * @param {String[]} args
   * @param {Object} options
   * @return {Promise}
   * @private
   */
  _spawn(binary, args, options = {}) {
    return spawner(
      binary,
      args,
      Object.assign({
        cwd: path.join(this._config.project.root, this._config.root),
        shell: true
      }, options),
      err => logger.error(this._addNameToMessage(err.toString())),
      data => logger.raw(this._addNameToMessage(data.toString()))
    );
  }

  /**
   * @return {Promise}
   * @protected
   * @abstract
   */
  checkProject() {
    throw new Error(`Implement 'checkProject' method...`);
  }

  /**
   * Get set of actions
   * @return {Promise}
   * @private
   */
  _getTask() {
    return this.checkProject()
      .then(() => this.on({ status: Dictionary.REALTIME.START }))
      .then(() => this._hook('before'))
      .then(() => this._runTerraformCommand(this._action))
      .then(data => this.upload(data))
      .then(res => this._hook('after', res))
      .then(data => this.on(data))
      .catch(err => this.on({ status: Dictionary.REALTIME.ERROR }, err));
  }

  /**
   * @param {Object} data
   * @return {Promise}
   * @protected
   * @abstract
   */
  upload(data) {
    throw new Error(`Implement 'upload' method...`);
  }

  /**
   * Add '[component_name] ' prefix to message
   * @param {String} message
   * @return {String}
   */
  _addNameToMessage(message) {
    return `[${this._config.name}] ${message}`;
  }
}

module.exports = AbstractTerrahub;
