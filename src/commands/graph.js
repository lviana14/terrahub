'use strict';

const treeify = require('treeify');
const { familyTree } = require('../helpers/util');
const AbstractCommand = require('../abstract-command');

class GraphCommand extends AbstractCommand {
  /**
   * Command configuration
   */
  configure() {
    this
      .setName('graph')
      .setDescription('show dependencies graph for terraform configuration mapped as terrahub components')
    ;
  }

  /**
   * Build modules graph
   * @returns {Promise}
   */
  run() {
    const { name, root } = this.getProjectConfig();

    if (!root) {
      throw new Error(`Project's config not found`);
    }

    const treeConfig = familyTree(this.getConfig());
    const configList = Object.keys(treeConfig).map(hash => treeConfig[hash]);
    const tree = this._format(configList);

    if (name) {
      this.logger.log(`Project: ${name}`);

      treeify.asLines(tree, false, line => {
        this.logger.log(` ${line}`);
      });

      this.logger.warn(`Above paths are relative to project's root`);
    }

    return Promise.resolve('Done');
  }

  /**
   * @param {Array} config
   * @returns {Object}
   * @private
   */
  _format(config) {
    const result = {};

    config.forEach(item => {
      const key = `${item.name} [path: ${item.root}]`;

      result[key] = item.children.length === 0 ? null : this._format(item.children);
    });

    return result;
  }
}

module.exports = GraphCommand;
