const config = require('../config')
const debug = require('debug')('api:postgres')
const EventEmitter = require('events').EventEmitter
const metadata = require('@dadi/metadata')
const { Pool, Client } = require('pg')
const util = require('util')
const uuid = require('uuid')

const STATE_DISCONNECTED = 0
const STATE_CONNECTED = 1
const STATE_CONNECTING = 2

/**
 * @typedef ConnectionOptions
 * @type {Object}
 * @property {string} database - the name of the database file to use
 * @property {Object} collection - the name of the collection to use
 */

/**
 * @typedef QueryOptions
 * @type {Object}
 * @property {number} limit - the number of records to return
 * @property {number} skip - an offset, the number of records to skip
 * @property {Object} sort - an object specifying properties to sort by. `{"title": 1}` will sort the results by the `title` property in ascending order. To reverse the sort, use `-1`: `{"title": -1}`
 * @property {Object} fields - an object specifying which properties to return. `{"title": 1}` will return results with all properties removed except for `_id` and `title`
 */

/**
 * Handles the interaction with <Database>
 * @constructor DataStore
 * @classdesc DataStore adapter for using <Database> with DADI API
 * @implements EventEmitter
 */
const DataStore = function DataStore (options) {
  this.config = options || config.get()
  this.readyState = STATE_DISCONNECTED

  this.internalProperties = [
    '_id',
    '_apiVersion',
    '_version',
    '_history',
    '_createdAt',
    '_createdBy',
    '_lastModifiedBy',
    '_lastModifiedAt'
  ]
}

util.inherits(DataStore, EventEmitter)

/**
 * Connect to the database
 *
 * @param {ConnectionOptions} options
 */
DataStore.prototype.connect = function (options) {
  debug('connect %o', options)

  return new Promise((resolve, reject) => {
    // problem connecting, emit 'DB_ERROR' event
    // this.emit('DB_ERROR', err)
    let client = new Client({
      user: config.get('database.user'),
      host: config.get('database.host'),
      database: config.get('database.database'),
      password: config.get('database.password'),
      port: config.get('database.port')
    })

    client.connect()

    this.database = client

    // everything is ok, emit 'DB_CONNECTED' event
    this.readyState = STATE_CONNECTED
    this.emit('DB_CONNECTED', this.database)

    return resolve()
  })
}

let operators = {
  '$eq': function (key, value, index) { return `"${key}" = $${index}` },
  '$containsAny': function (key, value, index) { return `"${key}" = ANY($1)` },
  '$ne': function (key, value, index) { return `#${key} <> :${key}` },
  '$in': function (key, value, index) { return `"${key}" = ANY($1)` },
  '$lt': function (key, value, index) { return `"${key}" < $${index}` },
  '$lte': function (key, value, index) { return `"${key}" <= $${index}` },
  '$gt': function (key, value, index) { return `"${key}" > $${index}` },
  '$gte': function (key, value, index) { return `"${key}" >= $${index}` },
  '$regex': function (key, value, index) { return `"${key}" ILIKE $${index}` }
}

/**
 * Query the database
 *
 * @param {Object} query - the query to perform
 * @param {string} collection - the name of the collection to query
 * @param {QueryOptions} options - a set of query options, such as offset, limit, sort, fields
 * @param {Object} schema - the JSON schema for the collection
 * @returns {Promise.<Array, Error>} A promise that returns an Array of results,
 *     or an Error if the operation fails
 */
DataStore.prototype.find = function ({ query, collection, options = {}, schema, settings }) {
  if (this.readyState !== STATE_CONNECTED) {
    return Promise.reject(new Error('DB_DISCONNECTED'))
  }

  options = options || {}

  debug('find in %s where %o %o', collection, query, options)

  let fields = '*'

  if (options.fields && Object.keys(options.fields).length > 0) {
    fields = Object.keys(options.fields)
    fields.unshift('_id')

    fields = fields.map((field, index) => {
      return `"${field}"`
    }).join(', ')
  }

  let queryText = `SELECT ${fields} FROM "${collection}"`

  if (Object.keys(query).length > 0) {
    queryText += ' WHERE '
    queryText += Object.keys(query).map((key, index, arr) => {
      if (Object.prototype.toString.call(query[key]) === '[object RegExp]') {
        return `"${key}" ILIKE $${index + 1}`
      } else {
        let operator = '$eq'
        let value = query[key]

        // if the value of this key is an object, it's a query operator
        // other than a basic equality operator e.g. { "key": 200 } vs. { "key": { "$lt": 200 } }
        if (typeof value === 'object') {
          operator = Object.keys(value)[0] || '$eq'
          value = value[Object.keys(value)[0]]
        }

        return operators[operator](key, value, index + 1)
      // return `"${key}" = $${index + 1}`
      }
    }).join(' AND ')
  }

  if (!options.sort) {
    options.sort = {}

    if (Object.keys(query).length === 0) {
      options.sort['_createdAt'] = 1
    } else {
      Object.keys(query).forEach(key => {
        options.sort[key] = 1
      })
    }
  }

  queryText += ` ORDER BY `
  queryText += Object.keys(options.sort)
    .map(key => `"${key}" ${options.sort[key] === 1 ? 'ASC' : 'DESC'}`)
    .join(', ')

  if (options.limit) {
    queryText += ` LIMIT ${options.limit}`
  }

  if (options.skip) {
    queryText += ` OFFSET ${options.skip}`
  }

  let transformedQuery = {
    text: queryText,
    values: Object.values(query).map((value, index, arr) => {
      if (Object.prototype.toString.call(value) === '[object RegExp]') {
        let re = new RegExp(value)
        console.log('re :', re)
        return `${re.source.replace('^', '').replace('$', '')}`
      } else if (typeof value === 'object') {
        if (Array.isArray(Object.values(value)[0])) {
          return `{${Object.values(value)[0].join(',')}}`
        }

        switch (Object.keys(value)[0]) {
          case '$regex':
            return `%${Object.values(value)[0]}%`
          default:
            return `${Object.values(value)[0]}`
        }
      } else {
        return value
      }
    })
  }

  debug('transformedQuery:', transformedQuery)

  return new Promise((resolve, reject) => {
    this.database.query(transformedQuery).then(response => {
      this.database.query(`SELECT COUNT(*) FROM "${collection}";`).then(count => {
        return resolve({
          results: response.rows,
          metadata: this.getMetadata(options, parseInt(count.rows[0].count))
        })
      })
    }).catch(err => {
      return reject(err)
    })
  })
}

/**
 * Insert documents into the database
 *
 * @param {Object|Array} data - a single document or an Array of documents to insert
 * @param {string} collection - the name of the collection to insert into
 * @param {object} options - options to modify the query
 * @param {Object} schema - the JSON schema for the collection
 * @returns {Promise.<Array, Error>} A promise that returns an Array of inserted documents,
 *     or an Error if the operation fails
 */
DataStore.prototype.insert = function ({data, collection, options = {}, schema, settings = {}}) {
  if (this.readyState !== STATE_CONNECTED) {
    return Promise.reject(new Error('DB_DISCONNECTED'))
  }

  debug('insert into %s %o', collection, data)

  // make an Array of documents if an Object has been provided
  if (!Array.isArray(data)) {
    data = [data]
  }

  return this.getCollection(collection, schema).then(() => {
    return new Promise((resolve, reject) => {
      let results = []
      let idx = 0

      // Add an _id if the document doesn't come with one
      data.forEach(document => {
        let keys = Object.keys(document).filter(key => key !== '_id')

        keys = keys.map(key => {
          if (key.indexOf('_ref') < 0) {
            return `"${key}"`
          }
        }).filter(Boolean)

        keys.push('_id')

        let placeholders = keys.map((currentValue, index, arr) => {
          return `$${index + 1}`
        }).join(', ')

        let text = `INSERT INTO "${collection}"(${keys.join(', ')}) VALUES(${placeholders}) RETURNING *;`
        let values = Object.keys(document).map(key => {
          if (!key.startsWith('_ref') && key !== '_id') {
            if (this.internalProperties.includes(key)) {
              if (key === '_createdAt') {
                return new Date(document[key])
              } else if (key === '_history') {
                return []
              } else {
                return document[key]
              }
            } else if (schema[key]) {
              if (typeof document[key] !== 'undefined') {
                if (schema[key].type === 'DateTime') {
                  return `${document[key]}`
                }

                return document[key]
              }
            }
          }
        }).filter(value => typeof value !== 'undefined')

        values.push(document._id || uuid.v4())

        debug(text, values)

        this.database.query(text, values).then(response => {
          results.push(response.rows[0])

          if (idx++ === data.length - 1) {
            return resolve(results)
          }
        }).catch(err => {
          console.error(err.stack)
        })
      })
    })
  })
}

/**
 * Update documents in the database
 *
 * @param {object} query - the query that selects documents for update
 * @param {string} collection - the name of the collection to update documents in
 * @param {object} update - the update for the documents matching the query
 * @param {object} options - options to modify the query
 * @param {object} schema - the JSON schema for the collection
 * @returns {Promise.<Array, Error>} A promise that returns an Array of updated documents,
 *     or an Error if the operation fails
 */
DataStore.prototype.update = function ({query, collection, update, options = {}, schema}) {
  if (this.readyState !== STATE_CONNECTED) {
    return Promise.reject(new Error('DB_DISCONNECTED'))
  }

  debug('update %s where %o with %o', collection, query, update)

  let condition = ''
  let updates = []

  if (Object.keys(update).length > 0) {
    Object.keys(update).forEach(operator => {
      switch (operator) {
        case '$set':
          Object.keys(update[operator]).map(key => {
            if (!key.startsWith('_ref')) {
              if (key === '_lastModifiedAt' || key === '_createdAt') {
                updates.push(`"${key}" = to_timestamp(${update[operator][key]})`)
              } else {
                updates.push(`"${key}" = '${update[operator][key]}'`)
              }
            }
          })

          break
        case '$inc':
          Object.keys(update[operator]).map(key => {
            if (!key.startsWith('_ref')) {
              updates.push(`"${key}" = "${key}" + ${update[operator][key]}`)
            }
          })
      }
    })
  }

  if (Object.keys(query).length > 0) {
    condition += ' WHERE '
    condition += Object.keys(query).map((key, index, arr) => {
      return `"${key}" = $${index + 1}`
    }).join(' AND ')
  }

  let text = `
  UPDATE "${collection}"
   SET ${updates.join(', ')}
   ${condition}
   RETURNING *
  `

  let values = Object.values(query)

  return new Promise((resolve, reject) => {
    this.database.query(text, values).then(response => {
      return resolve({
        results: response.rows
      })
    }).catch(err => {
      console.log('err :', err)
    })
  })
}

/**
 * Remove documents from the database
 *
 * @param {Object} query - the query that selects documents for deletion
 * @param {string} collection - the name of the collection to delete from
 * @param {Object} schema - the JSON schema for the collection
 * @returns {Promise.<Array, Error>} A promise that returns an Object with one property `deletedCount`,
 *     or an Error if the operation fails
 */
DataStore.prototype.delete = function ({query, collection, schema}) {
  if (this.readyState !== STATE_CONNECTED) {
    return Promise.reject(new Error('DB_DISCONNECTED'))
  }

  debug('delete from %s where %o', collection, query)

  let condition = ''

  if (Object.keys(query).length > 0) {
    condition += ' WHERE '
    condition += Object.keys(query).map((key, index, arr) => {
      return `"${key}" = $${index + 1}`
    }).join(' AND ')
  }

  let text = `
  DELETE FROM "${collection}"
   ${condition}
   RETURNING *
  `

  let values = Object.values(query)

  return new Promise((resolve, reject) => {
    this.database.query(text, values).then(response => {
      return resolve({ deletedCount: response.rowCount })
    })
  })
}

/**
 * Get metadata about the specfied collection, including number of records
 *
 * @param {Object} options - the query options passed from API, such as page, limit, skip
 * @returns {Object} an object containing the metadata about the collection
 */
DataStore.prototype.stats = function (collection, options) {
  if (this.readyState !== STATE_CONNECTED) {
    return Promise.reject(new Error('DB_DISCONNECTED'))
  }

  return new Promise((resolve, reject) => {
    let result = {
      count: 100
    }

    return resolve(result)
  })
}

/**
 * Get metadata about the specfied collection, including number of records
 *
 * @param {object} options - options passed to FIND, such as limit, skip, etc
 * @param {number} count - total count of all records
 * @returns {Object} an object containing the metadata for the query, such as totalPages, totalCount
 */
DataStore.prototype.getMetadata = function (options, count) {
  return metadata(options, count)
}

DataStore.prototype.getCollection = function (collection, schema) {
  return new Promise((resolve, reject) => {
    let query = `SELECT EXISTS (
      SELECT 1 
      FROM   pg_catalog.pg_class c
      JOIN   pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE  n.nspname = 'public'
      AND    c.relname = '${collection}'
      AND    c.relkind = 'r'
    );`

    return this.database.query(query).then(response => {
      if (response.rows[0].exists) {
        let queue = []
        Object.keys(schema).forEach(field => {
          let query = `
          SELECT '${field}' AS field, EXISTS (SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema='${'public'}' AND table_name='${collection}' AND column_name='${field}');
            `

          queue.push(this.database.query(query))
        })

        Promise.all(queue).then(responses => {
          let alterQueries = []
          responses.forEach(r => {
            if (!r.rows[0].exists) {
              let q = `ALTER TABLE "${collection}" ADD COLUMN "${r.rows[0].field}" ${getType(schema[r.rows[0].field].type)} ${schema[r.rows[0].field].required ? 'NOT NULL' : 'NULL'}`
              alterQueries.push(this.database.query(q))
            }
          })

          Promise.all(alterQueries).then(responses => {
            return resolve()
          })
        })
      } else {
        let createQuery = `CREATE TABLE "${collection}" (
          _id UUID PRIMARY KEY NOT NULL DEFAULT uuid_in((md5((random())::text))::cstring),
          "_history" VARCHAR (255) NULL,
          "_apiVersion" VARCHAR (50) NULL,
          "_version" INTEGER NULL,
          "_createdAt" TIMESTAMP NULL,
          "_createdBy" VARCHAR (255) NULL,
          "_lastModifiedAt" TIMESTAMP NULL,
          "_lastModifiedBy" VARCHAR (255) NULL,
          `

        createQuery += Object.keys(schema).map(field => {
          return `"${field}" ${getType(schema[field].type)} ${schema[field].required ? 'NOT NULL' : 'NULL'}`
        }).join(',\n')

        createQuery += ');'

        return this.database.query(createQuery).then(response => {
          return resolve()
        })
      }
    })
  })
}

function getType (type) {
  switch (type) {
    case 'DateTime':
      return 'TIMESTAMP'
    case 'Mixed':
    case 'Object':
      return 'JSON'
    case 'Number':
      return 'INTEGER'
    case 'Reference':
      return 'VARCHAR (255)'
    case 'String':
      return 'VARCHAR (255)'
  }
}

/**
 *
 */
DataStore.prototype.index = function (collection, indexes) {
  return new Promise((resolve, reject) => {
    // Create an index on the specified field(s)
    let results = []

    indexes.forEach((index, idx) => {
      results.push({
        collection: 'collection',
        index: 'indexName'
      })

      if (idx === indexes.length - 1) {
        return resolve(results)
      }
    })
  })
}

/**
 * Get an array of indexes
 *
 * @param {string} collectionName - the name of the collection to get indexes for
 * @returns {Array} - an array of index objects, each with a name property
 */
DataStore.prototype.getIndexes = function (collectionName) {
  if (this.readyState !== STATE_CONNECTED) {
    return Promise.reject(new Error('DB_DISCONNECTED'))
  }

  return new Promise((resolve, reject) => {
    let indexes = [{
      name: 'index_1'
    }]

    return resolve(indexes)
  })
}

DataStore.prototype.dropDatabase = function (collectionName) {
  if (this.readyState !== STATE_CONNECTED) {
    return Promise.reject(new Error('DB_DISCONNECTED'))
  }

  debug('dropDatabase %s', collectionName || '')

  return new Promise((resolve, reject) => {
    return resolve()
  })
}

module.exports = DataStore
