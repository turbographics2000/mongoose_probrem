'use strict';

/*!
 * koa-generic-session-mongo
 * Copyright(c) 2013 Pavel Vlasov <freakycue@gmail.com>
 * MIT Licensed
 */

import { EventEmitter } from 'events';
import { MongoClient } from 'mongodb';
import thunkify from 'thunkify';
import debug from 'debug';

const log = debug('koa-generic-session-mongo:store');
const ONE_DAY = 86400 * 1000;
const DEFAULT_DBNAME = 'sessiondb';
const DEFAULT_COLLECTION = 'sessions';

export default class MongoStore extends EventEmitter {
  /**
   * Initialize MongoStore with the given `options`.
   *
   * @param {Object} options
   * @api public
   */
  constructor(options = {}) {
    super();
    const {
      db,
      collection,
      url,
      user,
      password,
      connectOptions
    } = options;

    if (url && ('host' in options || 'port' in options || 'db' in options || 'ssl' in options)) {
      throw new Error('url option is exclusive from host, port, db and ssl options, please include as a full url connection string');
    }

    this.col = db && typeof db !== 'string' && typeof db.dropDatabase === 'function' ?
      this._initWithDb({ db, collection }) :
      this._initWithUrl({
        url: url || MongoStore._makeConnectionString(user, password, options),
        collection,
        connectOptions
      });

    this.col
      .then(MongoStore._ensureIndexes)
      .then((collection) => {
        this.emit('connect', collection);
      }).catch((err) => {
        this.emit('error', err);
      });
  }

  /**
   * Init session collection with given database object
   * @param db Database object
   * @param collection Collection name which will store our sessions
   * @returns {Promise.<*>}
   * @private
   */
  _initWithDb({ db, collection = DEFAULT_COLLECTION }) {
    return Promise.resolve(db.collection(collection));
  }

  /**
   *
   * @param url Connection string to db
   * @param user
   * @param password
   * @param collection Collection name which will store our sessions
   * @returns {Promise}
   * @private
   */
  _initWithUrl({ url, collection = DEFAULT_COLLECTION, connectOptions = null }) {
    return new Promise((resolve, reject) => {
      MongoClient.connect(url, connectOptions, function (err, client) {
        if (err) {
          reject(err);
          return;
        }
        const options = (client && client.s && client.s.options && client.s.options) || {};
        const dbName = options.dbName || DEFAULT_DBNAME;
        var db = client.db(dbName);
        const col = db.collection(collection);
        resolve(col);
      });
    })
  }

  static _makeConnectionString(user, password, { host = '127.0.0.1', port = 27017, db = 'test', ssl = false }) {
    return `mongodb://${user && password ? `${user}:${password}@` : ''}${host}:${port}/${db}${ssl ? '?ssl=true' : ''}`;
  }

  /**
   * Create ttl and sid indexes
   * @param col
   * @returns {Promise}
   */
  static _ensureIndexes(col) {
    return new Promise(function (resolve, reject) {
      let times = 2;

      function done(err) {
        if (err) {
          reject(err);
        } else if (--times < 1) {
          resolve(col);
        }
      }

      col.ensureIndex({ ttl: 1 }, { expireAfterSeconds: 0 }, done);
      col.ensureIndex({ sid: 1 }, { unique: true }, done);
    });
  }

  /**
   * Attempt to fetch session by the given `sid`.
   *
   * @param {String} sid
   * @param {Function} fn
   * @api public
   */
  *get(sid) {
    const col = yield this.col;
    const findOne = thunkify(col.findOne.bind(col));

    return yield findOne({ sid: sid }, { _id: 0, ttl: 0, sid: 0 });
  }

  /**
   * Commit the given `sess` object associated with the given `sid`.
   *
   * @param {String} sid
   * @param {Session} sess
   * @api public
   */
  *set(sid, sess, ttl) {
    // clone original sess
    sess = Object.assign({}, sess);
    const maxAge = sess.cookie && (sess.cookie.maxAge || sess.cookie.maxage);
    const col = yield this.col;
    const update = thunkify(col.update.bind(col));

    sess.sid = sid;
    sess.ttl = new Date((ttl || ('number' == typeof maxAge
      ? maxAge : ONE_DAY)) + Date.now());

    return yield update({ sid: sid }, sess, { upsert: true });
  }

  /**
   * Destroy the session associated with the given `sid`.
   *
   * @param {String} sid
   * @api public
   */
  *destroy(sid) {
    const col = yield this.col;
    const remove = thunkify(col.remove.bind(col));

    yield remove({ sid: sid });
  }
}
