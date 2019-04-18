'use strict';

const AWS = require('aws-sdk');
const fse = require('fs-extra');

class S3Helper {
  /**
   *
   */
  constructor() {
    this._s3 = new AWS.S3();
  }

  /**
   * Create s3 object
   * @param {String} bucketName
   * @param {String} objectKey
   * @param {Buffer|Blob|String|ReadableStream} body
   * @returns {Promise}
   */
  writeFile(bucketName, objectKey, body = '') {
    return this._s3.putObject({ Bucket: bucketName, Key: objectKey, Body: body }).promise();
  }

  /**
   * @param {String} bucketName
   * @param {{ localPath: String, s3Path: String }[]} pathMap
   * @return {Promise}
   */
  uploadFiles(bucketName, pathMap) {
    return Promise.all(pathMap.map(path =>
      this.writeFile(bucketName, path.s3Path, fse.createReadStream(path.localPath))
    ));
  }

  /**
   * @param {String} bucketName
   * @param {String} prefix
   * @param {Boolean} returnChunks
   * @return {Promise<String[]|Array[]>}
   */
  listObjects(bucketName, prefix, { returnChunks = false } = {}) {
    const commonParams = {
      Bucket: bucketName,
      Prefix: prefix
    };
    const chunks = [];

    /**
     * @param {String} continuationToken
     * @return {Promise}
     */
    const iterate = (continuationToken = null) => {
      const params = continuationToken ?
        Object.assign({ ContinuationToken: continuationToken }, commonParams) :
        commonParams;

      return this._s3.listObjectsV2(params).promise().then(data => {
        chunks.push(data.Contents.map(content => content.Key));

        return data.IsTruncated ? iterate(data.NextContinuationToken) : Promise.resolve(chunks);
      });
    };

    return iterate().then(() => returnChunks ? chunks : [].concat(...chunks));
  }
		
  /**
   * Get s3 object
   * @param {String} bucketName
   * @param {String} objectKey
   * @returns {Promise}
   */
  getObject(bucketName, objectKey) {
    return this._s3.getObject({ Bucket: bucketName, Key: objectKey }).promise();
  }

  /**
   * Metadata bucket name
   * @returns {String}
   * @constructor
   */
  static get METADATA_BUCKET() {
    return 'data-lake-terrahub-us-east-1';
  }
}

module.exports = S3Helper;
