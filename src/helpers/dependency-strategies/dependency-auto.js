'use strict';
const DependencyStrategy = require('./abstract-dependency-strategy');


class DependencyAuto extends DependencyStrategy {

  execute(filteredConfig, fullConfig) {
    console.log('implemented Auto strategy');
    return this.config;
  }
}

module.exports = DependencyAuto;