'use strict';

const Distributor = require('../helpers/distributor');
const TerraformCommand = require('../terraform-command');
const { yesNoQuestion } = require('../helpers/util');

class OutputCommand extends TerraformCommand {
  /**
   * Command configuration
   */
  configure() {
    this
      .setName('output')
      .setDescription('run `terraform output` across multiple terrahub components')
      .addOption('format', 'o', 'Specify the output format (text or json)', String, 'text')
      .addOption('auto-approve', 'y', 'Auto approve terraform execution', Boolean, false)
    ;
  }

  /**
   * @returns {Promise}
   */
  run() {
    this._format = this.getOption('format');

    if (!['text', 'json'].includes(this._format)) {
      return Promise.reject(new Error(`The '${this._format}' output format is not supported for this command.`));
    }

    return this._format === 'text' ? this.askQuestion() : this.performAction();
  }

  /**
   * @return {Promise}
   */
  askQuestion() {
 
    return this._getPromise().then(confirmed => {
      if (!confirmed) {
        return Promise.resolve('Canceled');
      }

      return this.performAction();
    });
  }

  /**
   * @return {Promise}
   */
  performAction() {
    const config = this.getConfigObject();
    const distributor = new Distributor(config);

    return distributor.runActions(['prepare', 'output'], {
      format: this._format 
    });
  }

  /**
   * @return {Promise}
   * @private
   */
  _getPromise() {
    if (this.getOption('auto-approve')) {
      return Promise.resolve(true);
    } else {
      this.logger.warn('This command makes sense only after apply command, and configured outputs');

      return yesNoQuestion('Do you want to run it (Y/N)? ');
    }
  }
}

module.exports = OutputCommand;