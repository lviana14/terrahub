'use strict';

class AbstractDependencyStrategy {

  /**
   * @param filteredConfig
   * @param fullConfig
   * @return {void}
   */
  execute(filteredConfig, fullConfig) {
    throw new Error('Strategy#execute needs to be overridden.');
  }

  /**
   * @param {Object} fullConfig
   * @param {Function<boolean>[]} filters
   * @return {Object}
   */
  generateExecutionList(fullConfig, filters = []) {
    const config = Object.assign({}, fullConfig);

    Object.keys(config)
      .filter(hash => filters.some(check => !check(hash)))
      .forEach(hash => { delete config[hash]; });

    return config;
  }
}

module.exports = AbstractDependencyStrategy;
