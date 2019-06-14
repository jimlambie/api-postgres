var ApiConnector = require('../lib')
var EventEmitter = require('events').EventEmitter
var fs = require('fs')
var path = require('path')
var querystring = require('querystring')
var should = require('should')
var url = require('url')
var uuid = require('uuid')

var config = require(__dirname + '/../config')

function buildDocument (obj, overrides) {
  // obj._createdAt = Date.now()

  // Object.assign(obj, overrides || {})
  return obj
}

describe('PostgresApiConnector', function () {
  this.timeout(3000)

  var schema
  var userSchema

  before(done => {
    schema = JSON.parse(fs.readFileSync(__dirname + '/collection.book.json').toString())
    userSchema = JSON.parse(fs.readFileSync(__dirname + '/collection.user.json').toString())
    done()
  })

  beforeEach(done => {
    var apiConnector = new ApiConnector()
    apiConnector.connect({ database: 'content', collection: 'books' }).then(() => {
      apiConnector.delete({ query: {}, collection: 'books' }).then(() => {
        apiConnector.delete({ query: {}, collection: 'users' }).then(() => {
          done()
        })
      })
    })
  })

  afterEach(done => {
    setTimeout(() => {
      done()
    }, 1000)
  })

  after(done => {
    done()
  })

  describe('constructor', function () {
    it('should be exposed', function (done) {
      ApiConnector.should.be.Function
      done()
    })

    it('should inherit from EventEmitter', function (done) {
      var apiConnector = new ApiConnector()
      apiConnector.should.be.an.instanceOf(EventEmitter)
      apiConnector.emit.should.be.Function
      done()
    })

    it.skip('should load config if no options supplied', function (done) {
      var apiConnector = new ApiConnector()
      should.exist(apiConnector.config)
      apiConnector.config.database.name.should.eql('my_database')
      done()
    })

    it('should load config from options supplied', function (done) {
      var apiConnector = new ApiConnector({ database: { host: 'localhost' } })
      should.exist(apiConnector.config)
      apiConnector.config.database.host.should.eql('localhost')
      done()
    })

    it('should have readyState == 0 when initialised', function (done) {
      var apiConnector = new ApiConnector()
      apiConnector.readyState.should.eql(0)
      done()
    })
  })

  describe('connect', function () {
    it('should create and return database when connecting', function (done) {
      var apiConnector = new ApiConnector()
      apiConnector.connect({ database: 'content' })
      should.exist(apiConnector.database)
      done()
    })

    it('should have readyState == 1 when connected', function (done) {
      var apiConnector = new ApiConnector()
      apiConnector.connect({ database: 'content', collection: 'posts' }).then(() => {
        apiConnector.readyState.should.eql(1)
        done()
      })
    })
  })

  describe('insert', function () {
    it('should insert a single document into the database', function (done) {
      var apiConnector = new ApiConnector()
      apiConnector.connect({ database: 'content', collection: 'users' }).then(() => {
        var book = buildDocument({ title: 'The Sun Also Rises', datePublished: '22 October 1926', authorId: '100' })

        apiConnector.insert({ data: book, collection: 'books', schema: schema.fields, settings: schema.settings }).then((results) => {
          results.constructor.name.should.eql('Array')
          results[0].title.should.eql('The Sun Also Rises')
          done()
        }).catch((err) => {
          done(err)
        })
      })
    })

    it('should insert an array of documents into the database', function (done) {
      var apiConnector = new ApiConnector()
      apiConnector.connect({ database: 'content', collection: 'users' }).then(() => {
        var books = [
          buildDocument({ title: 'War and Peace', datePublished: '01 July 1869', authorId: '100' }),
          buildDocument({ title: 'The Sisters Brothers', datePublished: '26 April 2011', authorId: '100' })
        ]

        apiConnector.insert({ data: books, collection: 'books', schema: schema.fields, settings: schema.settings }).then((results) => {
          results.constructor.name.should.eql('Array')
          results.length.should.eql(2)
          results[0].title.should.eql('War and Peace')
          results[1].title.should.eql('The Sisters Brothers')
          done()
        }).catch((err) => {
          done(err)
        })
      })
    })

    it('should add _id property if one isn\'t specified', function (done) {
      var apiConnector = new ApiConnector()
      apiConnector.connect({ database: 'content', collection: 'users' }).then(() => {
        var books = [
          buildDocument({ title: 'War and Peace', datePublished: '01 July 1869', authorId: '100' }),
          buildDocument({ title: 'The Sisters Brothers', datePublished: '26 April 2011', authorId: '100' })
        ]

        apiConnector.insert({ data: books, collection: 'books', schema: schema.fields, settings: schema.settings }).then(results => {
          results.constructor.name.should.eql('Array')
          results.length.should.eql(2)
          results[0].title.should.eql('War and Peace')
          should.exist(results[0]._id)
          done()
        }).catch((err) => {
          done(err)
        })
      })
    })

    it('should use specified _id property if one is specified', function (done) {
      var apiConnector = new ApiConnector()
      apiConnector.connect({ database: 'content', collection: 'users' }).then(() => {
        var books = [
          buildDocument({ _id: uuid.v4(), title: 'War and Peace', datePublished: '01 July 1869', authorId: '100' }),
          buildDocument({ _id: uuid.v4(), title: 'The Sisters Brothers', datePublished: '26 April 2011', authorId: '100' })
        ]

        apiConnector.insert({ data: books, collection: 'books', schema: schema.fields, settings: schema.settings }).then(results => {
          results.constructor.name.should.eql('Array')
          results.length.should.eql(2)
          results[0].title.should.eql('War and Peace')
          results[0]._id.should.eql(books[0]._id)
          done()
        }).catch((err) => {
          done(err)
        })
      })
    })
  })

  describe('find', function () {
    it('should find a single document in the database using _id', function (done) {
      var apiConnector = new ApiConnector()
      apiConnector.connect({ database: 'content', collection: 'books' }).then(() => {
        var books = [
          buildDocument({ _id: uuid.v4(), title: 'War and Peace', datePublished: '01 July 1869', authorId: '100' }),
          buildDocument({ title: 'The Sisters Brothers', datePublished: '26 April 2011', authorId: '100' })
        ]

        apiConnector.insert({ data: books, collection: 'books', schema: schema.fields, settings: schema.settings }).then((results) => {
          apiConnector.find({
            query: { _id: books[0]._id },
            collection: 'books',
            schema: schema.fields,
            settings: schema.settings
          }).then(results => {
            results = results.results
            results.constructor.name.should.eql('Array')
            results[0].title.should.eql('War and Peace')
            done()
          }).catch((err) => {
            done(err)
          })
        })
      })
    })

    it('should find a single document in the database using another attribute', function (done) {
      var apiConnector = new ApiConnector()
      apiConnector.connect({ database: 'content', collection: 'books' }).then(() => {
        var books = [
          buildDocument({ _id: uuid.v4(), title: 'War and Peace', datePublished: '01 July 1869', authorId: '100' }),
          buildDocument({ title: 'The Sisters Brothers', datePublished: '26 April 2011', authorId: '100' })
        ]

        apiConnector.insert({ data: books, collection: 'books', schema: schema.fields, settings: schema.settings }).then((results) => {
          apiConnector.find({
            query: { title: 'War and Peace' },
            collection: 'books',
            schema: schema.fields,
            settings: schema.settings
          }).then(results => {
            results = results.results
            results.constructor.name.should.eql('Array')
            results[0].title.should.eql('War and Peace')
            done()
          }).catch((err) => {
            done(err)
          })
        })
      })
    })

    it('should return the number of records requested when using `limit`', function (done) {
      var apiConnector = new ApiConnector()
      apiConnector.connect({ database: 'content', collection: 'users' }).then(() => {
        var books = [
          buildDocument({ _id: uuid.v4(), title: 'War and Peace', datePublished: '01 July 1869', authorId: '100' }),
          buildDocument({ title: 'The Sisters Brothers', datePublished: '26 April 2011', authorId: '100' }),
          buildDocument({ title: 'The Sisters Brothers', datePublished: '26 April 2013', authorId: '100' })
        ]

        apiConnector.insert({ data: books, collection: 'books', schema: schema.fields, settings: schema.settings }).then((results) => {
          apiConnector.find({
            query: { title: 'The Sisters Brothers' },
            collection: 'books',
            schema: schema.fields,
            settings: schema.settings,
            options: { limit: 2 }
          }).then(results => {
            results.results.constructor.name.should.eql('Array')
            results.results.length.should.eql(2)
            done()
          }).catch((err) => {
            done(err)
          })
        }).catch((err) => {
          done(err)
        })
      })
    })

    it('should sort records in ascending order by the `_createdAt` property when no query or sort are provided', function (done) {
      var apiConnector = new ApiConnector()

      apiConnector.connect({ database: 'content', collection: 'users' }).then(() => {
        var users = [{ name: 'Ernie' }, { name: 'Oscar' }, { name: 'BigBird' }]

        apiConnector.insert({ data: users, collection: 'users', schema: userSchema.fields, settings: userSchema.settings }).then(results => {
          apiConnector.find({
            query: {},
            collection: 'users',
            schema: userSchema.fields,
            settings: userSchema.settings
          }).then(results => {
            results.results.constructor.name.should.eql('Array')
            results.results.length.should.eql(3)

            results.results[0].name.should.eql('Ernie')
            results.results[1].name.should.eql('Oscar')
            results.results[2].name.should.eql('BigBird')
            done()
          }).catch((err) => {
            done(err)
          })
        }).catch((err) => {
          done(err)
        })
      })
    })

    it('should sort records in ascending order by the query property when no sort is provided', function (done) {
      var apiConnector = new ApiConnector()

      apiConnector.connect({ database: 'content', collection: 'users' }).then(() => {
        var users = [{ name: 'BigBird 3' }, { name: 'BigBird 1' }, { name: 'BigBird 2' }]

        apiConnector.insert({ data: users, collection: 'users', schema: userSchema.fields, settings: userSchema.settings }).then(results => {
          apiConnector.find({
            query: { name: { '$regex': 'Big' } },
            collection: 'users',
            schema: userSchema.fields,
            settings: userSchema.settings
          }).then(results => {
            results.results.constructor.name.should.eql('Array')
            results.results.length.should.eql(3)
            results.results[0].name.should.eql('BigBird 1')
            results.results[1].name.should.eql('BigBird 2')
            results.results[2].name.should.eql('BigBird 3')
            done()
          }).catch((err) => {
            done(err)
          })
        }).catch((err) => {
          done(err)
        })
      })
    })

    it('should sort records in descending order by the specified property', function (done) {
      var apiConnector = new ApiConnector()
      apiConnector.connect({ database: 'content', collection: 'users' }).then(() => {
        var books = [
          buildDocument({ _id: uuid.v4(), title: 'War and Peace', datePublished: '01 July 1869', authorId: '100' }),
          buildDocument({ title: 'ABC', datePublished: '26 April 2011', authorId: '100' }),
          buildDocument({ title: 'ZYX', datePublished: '26 April 2013', authorId: '100' })
        ]

        apiConnector.insert({ data: books, collection: 'books', schema: schema.fields, settings: schema.settings }).then((results) => {
          apiConnector.find({
            query: {},
            collection: 'books',
            schema: schema.fields,
            settings: schema.settings,
            options: { sort: { title: -1 } }
          }).then(results => {
            results.results.constructor.name.should.eql('Array')
            results.results[0].title.should.eql('ZYX')
            done()
          }).catch((err) => {
            done(err)
          })
        }).catch((err) => {
          done(err)
        })
      })
    })

    it('should sort records in ascending order by the specified property', function (done) {
      var apiConnector = new ApiConnector()
      apiConnector.connect({ database: 'content', collection: 'users' }).then(() => {
        var books = [
          buildDocument({ _id: uuid.v4(), title: 'War and Peace', datePublished: '01 July 1869', authorId: '100' }),
          buildDocument({ title: 'ABC', datePublished: '26 April 2011', authorId: '100' }),
          buildDocument({ title: 'ZXY', datePublished: '26 April 2013', authorId: '100' })
        ]

        apiConnector.insert({ data: books, collection: 'books', schema: schema.fields, settings: schema.settings }).then((results) => {
          apiConnector.find({
            query: {},
            collection: 'books',
            schema: schema.fields,
            settings: schema.settings,
            options: { sort: { title: 1 } }
          }).then(results => {
            results.results.constructor.name.should.eql('Array')
            results.results[0].title.should.eql('ABC')
            done()
          }).catch((err) => {
            done(err)
          })
        }).catch((err) => {
          done(err)
        })
      })
    })

    it('should return only the fields specified by the `fields` property', function (done) {
      var apiConnector = new ApiConnector()
      apiConnector.connect({ database: 'content', collection: 'users' }).then(() => {
        var books = [
          buildDocument({ _id: uuid.v4(), title: 'War and Peace', datePublished: '01 July 1869', authorId: '100' }),
          buildDocument({ title: 'ABC', datePublished: '26 April 2011', authorId: '100' }),
          buildDocument({ title: 'ZXY', datePublished: '26 April 2013', authorId: '100' })
        ]

        apiConnector.insert({ data: books, collection: 'books', schema: schema.fields, settings: schema.settings }).then((results) => {
          apiConnector.find({
            query: {},
            collection: 'books',
            schema: schema.fields,
            settings: schema.settings,
            options: { fields: { title: 1 } }
          }).then(results => {
            results.results.constructor.name.should.eql('Array')

            Object.keys(results.results[0]).length.should.eql(2)
            Object.keys(results.results[0])[0].should.eql('_id')
            Object.keys(results.results[0])[1].should.eql('title')
            done()
          }).catch((err) => {
            done(err)
          })
        }).catch((err) => {
          done(err)
        })
      })
    })

    it('should handle all query operators', function (done) {
      // '$ne', '$in', '$lte', '$lt', '$gte', '$gt', '$between', '$not_null', '$null', '$contains', '$not_countains', '$regex'
      var apiConnector = new ApiConnector()

      apiConnector.connect({ database: 'content', collection: 'books' }).then(() => {
        var books = []

        books.push(buildDocument({ _id: uuid.v4(), title: 'Amazon Adventure 1', authorId: '100', datePublished: '21 March 1949' }))
        books.push(buildDocument({ _id: uuid.v4(), title: 'Amazon Adventure 2', authorId: '100', datePublished: '21 March 1949' }))
        books.push(buildDocument({ _id: uuid.v4(), title: 'Amazon Adventure 3', authorId: '100', datePublished: '21 March 1949' }))
        books.push(buildDocument({ _id: uuid.v4(), title: 'Wild Cats', edition: 1, authorId: '100', datePublished: '29 May 2001' }))
        books.push(buildDocument({ _id: uuid.v4(), title: 'Wild Cats, 2nd Edition', edition: 2, authorId: '100', datePublished: '29 May 2010' }))
        books.push(buildDocument({ _id: uuid.v4(), title: 'Wild Cats', edition: 3, authorId: '100', datePublished: '29 May 2004' }))
        books.push(buildDocument({ _id: uuid.v4(), title: 'Wild Cats', edition: 4, authorId: '100', datePublished: '29 May 2005' }))
        books.push(buildDocument({ _id: uuid.v4(), title: 'Wild Cats', edition: 5, authorId: '100', datePublished: '29 May 2007' }))

        apiConnector.insert({ data: books, collection: 'books', schema: schema.fields, settings: schema.settings }).then(results => {
          var queue = []

          queue.push(new Promise((resolve, reject) => {
            apiConnector.find({
              query: { title: 'Amazon Adventure 1' },
              collection: 'books',
              options: {},
              schema: schema.fields,
              settings: schema.settings
            }).then(results => {
              results = results.results
              if (results && results[0].title === 'Amazon Adventure 1') {
                console.log(' = OK')
                return resolve()
              } else {
                var err = new Error('Implicit equality query failed with ' + JSON.stringify(results))
                return reject(err)
              }
            }).catch((err) => {
              return done(err)
            })
          }))

          queue.push(new Promise((resolve, reject) => {
            apiConnector.find({
              query: { title: { '$eq': 'Amazon Adventure 1' } },
              collection: 'books',
              options: {},
              schema: schema.fields,
              settings: schema.settings
            }).then(results => {
              results = results.results
              if (results && results[0].title === 'Amazon Adventure 1') {
                console.log(' $eq OK')
                return resolve()
              } else {
                var err = new Error('$eq query failed with ' + JSON.stringify(results))
                return reject(err)
              }
            }).catch((err) => {
              return done(err)
            })
          }))

          queue.push(new Promise((resolve, reject) => {
            apiConnector.find({
              query: { title: { '$regex': 'adventure' } },
              collection: 'books',
              options: {},
              schema: schema.fields,
              settings: schema.settings
            }).then(results => {
              results = results.results
              if (results && results[0].title.indexOf('Adventure') > 0) {
                console.log(' $regex OK')
                return resolve()
              } else {
                var err = new Error('$regex query failed with ' + JSON.stringify(results))
                return reject(err)
              }
            }).catch((err) => {
              return done(err)
            })
          }))

          queue.push(new Promise((resolve, reject) => {
            apiConnector.find({
              query: { edition: { '$in': [2, 3] } },
              collection: 'books',
              options: {},
              schema: schema.fields,
              settings: schema.settings
            }).then(results => {
              results = results.results
              if (results && (results[0].edition === 2 || results[1].edition === 2)) {
                console.log(' $in OK')
                return resolve()
              } else {
                var err = new Error('$in query failed with ' + JSON.stringify(results))
                return reject(err)
              }
            }).catch((err) => {
              return done(err)
            })
          }))

          queue.push(new Promise((resolve, reject) => {
            apiConnector.find({
              query: { edition: { '$containsAny': [2, 3] } },
              collection: 'books',
              options: { sort: { edition: -1 } },
              schema: schema.fields,
              settings: schema.settings
            }).then(results => {
              results = results.results
              if (results && results[0].edition === 3) {
                console.log(' $containsAny OK')
                return resolve()
              } else {
                var err = new Error('$containsAny query failed with ' + JSON.stringify(results))
                return reject(err)
              }
            }).catch((err) => {
              return done(err)
            })
          }))

          queue.push(new Promise((resolve, reject) => {
            apiConnector.find({
              query: { edition: { '$lt': 2 } },
              collection: 'books',
              options: {},
              schema: schema.fields,
              settings: schema.settings
            }).then(results => {
              results = results.results
              if (results && results[0].edition === 1) {
                console.log(' $lt OK')
                return resolve()
              } else {
                var err = new Error('$lt query failed with ' + JSON.stringify(results))
                return reject(err)
              }
            }).catch((err) => {
              return done(err)
            })
          }))

          queue.push(new Promise((resolve, reject) => {
            apiConnector.find({
              query: { edition: { '$lte': 3 } },
              collection: 'books',
              options: { sort: { edition: -1 } },
              schema: schema.fields,
              settings: schema.settings
            }).then(results => {
              results = results.results
              if (results && results[0].edition === 3) {
                console.log(' $lte OK')
                return resolve()
              } else {
                var err = new Error('$lte query failed with ' + JSON.stringify(results))
                return reject(err)
              }
            }).catch((err) => {
              return done(err)
            })
          }))

          queue.push(new Promise((resolve, reject) => {
            apiConnector.find({
              query: { edition: { '$gt': 2 } },
              collection: 'books',
              options: {},
              schema: schema.fields,
              settings: schema.settings
            }).then(results => {
              results = results.results
              if (results && results[0].edition === 3) {
                console.log(' $gt OK')
                return resolve()
              } else {
                var err = new Error('$gt query failed with ' + JSON.stringify(results))
                return reject(err)
              }
            }).catch((err) => {
              return done(err)
            })
          }))

          queue.push(new Promise((resolve, reject) => {
            apiConnector.find({
              query: { edition: { '$gte': 2 } },
              collection: 'books',
              options: { sort: { edition: 1 } },
              schema: schema.fields,
              settings: schema.settings
            }).then(results => {
              results = results.results
              if (results && results[0].edition === 2) {
                console.log(' $gte OK')
                return resolve()
              } else {
                var err = new Error('$gte query failed with ' + JSON.stringify(results))
                return reject(err)
              }
            }).catch((err) => {
              return done(err)
            })
          }))

          // queue.push(new Promise((resolve, reject) => {
          //   apiConnector.find({
          //     query: { edition: { '$exists': false } },
          //     collection: 'books',
          //     options: {},
          //     schema: schema.fields,
          //     settings: schema.settings
          //   }).then(results => {
          //     results = results.results
          //     if (results && results.length === 3 && results[0].title.indexOf('Wild Cats') === -1) {
          //       console.log(' $exists === true OK')
          //       return resolve()
          //     } else {
          //       var err = new Error('$not_exists query failed with ' + JSON.stringify(results))
          //       return reject(err)
          //     }
          //   }).catch((err) => {
          //     return done(err)
          //   })
          // }))

          // queue.push(new Promise((resolve, reject) => {
          //   apiConnector.find({
          //     query: { edition: { '$exists': true } },
          //     collection: 'books',
          //     options: {},
          //     schema: schema.fields,
          //     settings: schema.settings
          //   }).then(results => {
          //     results = results.results
          //     if (results && results.length === 5 && results[0].title.indexOf('Wild Cats') > -1) {
          //       console.log(' $exists === false OK')
          //       return resolve()
          //     } else {
          //       var err = new Error('$exists query failed with ' + JSON.stringify(results))
          //       return reject(err)
          //     }
          //   }).catch((err) => {
          //     return done(err)
          //   })
          // }))

          Promise.all(queue).then((results) => {
            done()
          }).catch((err) => {
            console.log(err)
            done(err)
          })
        })
      }).catch((err) => {
        done(err)
      })
    })
  })

  describe('update', function () {
    describe('$set', function () {
      it('should update documents matching the query', function (done) {
        var apiConnector = new ApiConnector()
        apiConnector.connect({ database: 'content', collection: 'users' }).then(() => {
          var books = [
            buildDocument({ _id: uuid.v4(), title: 'War and Peace', datePublished: '01 July 1869', authorId: '100' }),
            buildDocument({ title: 'The Sisters Brothers', datePublished: '26 April 2011', authorId: '100' })
          ]

          apiConnector.insert({ data: books, collection: 'books', schema: schema.fields, settings: schema.settings }).then((results) => {
            apiConnector.update({ query: { title: 'The Sisters Brothers' }, collection: 'books', update: { '$set': { title: 'The Mike Myers Filmography' } } }).then((results) => {
              results = results.results
              results.constructor.name.should.eql('Array')
              results[0].title.should.eql('The Mike Myers Filmography')
              done()
            })
          })
        })
      })
    })

    describe('$inc', function () {
      it('should update documents matching the query', function (done) {
        var apiConnector = new ApiConnector()
        apiConnector.connect({ database: 'content', collection: 'users' }).then(() => {
          var books = [
            buildDocument({ _id: uuid.v4(), title: 'War and Peace', datePublished: '01 July 1869', authorId: '100', reviews: 0 }),
            buildDocument({ title: 'The Sisters Brothers', datePublished: '26 April 2011', authorId: '100', reviews: 0 })
          ]

          apiConnector.insert({ data: books, collection: 'books', schema: schema.fields, settings: schema.settings }).then((results) => {
            apiConnector.update({ query: { title: 'The Sisters Brothers' }, collection: 'books', update: { '$inc': { reviews: 1 } } }).then((results) => {
              results = results.results
              results.constructor.name.should.eql('Array')
              results[0].reviews.should.eql(1)
              done()
            })
          })
        })
      })
    })
  })

  describe('delete', function () {
    it('should delete documents matching the query', function (done) {
      var apiConnector = new ApiConnector()
      apiConnector.connect({ database: 'content', collection: 'users' }).then(() => {
        var users = [{ name: 'Ernie', age: 7, colour: 'yellow' }, { name: 'Oscar', age: 9, colour: 'green' }, { name: 'BigBird', age: 13, colour: 'yellow' }]

        apiConnector.insert({ data: users, collection: 'users', schema: userSchema.fields, settings: userSchema.settings }).then(results => {
          apiConnector.delete({ query: { colour: 'green' }, collection: 'users' }).then(results => {
            results.deletedCount.should.be.above(0)

            done()
          }).catch((err) => {
            done(err)
          })
        }).catch((err) => {
          done(err)
        })
      })
    })
  })

  describe.skip('database', function () {
    it('should contain all collections that have been inserted into', function (done) {
      var apiConnector = new ApiConnector()
      apiConnector.connect({ database: 'content', collection: 'users' }).then(() => {
        var user = { name: 'David' }

        apiConnector.insert(user, 'users', {}).then((results) => {
          results.constructor.name.should.eql('Array')
          results[0].name.should.eql('David')

          apiConnector.connect({ database: 'content', collection: 'posts' }).then(() => {
            var post = { title: 'David on Holiday' }

            apiConnector.insert(post, 'posts', {}).then((results) => {
              results.constructor.name.should.eql('Array')
              results[0].title.should.eql('David on Holiday')

              var u = apiConnector.database.getCollection('users')
              var p = apiConnector.database.getCollection('posts')
              should.exist(u)
              should.exist(p)
              done()
            }).catch((err) => {
              done(err)
            })
          }).catch((err) => {
            done(err)
          })
        })
      })
    })

    it('should handle connection to multiple databases', function (done) {
      var contentStore = new ApiConnector()
      var authStore = new ApiConnector()

      contentStore.connect({ database: 'content' }).then(() => {
        authStore.connect({ database: 'auth' }).then(() => {
          contentStore.insert({ name: 'Jim' }, 'users', {}).then((results) => {
            authStore.insert({ token: '123456123456123456123456' }, 'token-store', {}).then((results) => {
              contentStore.find({ name: 'Jim' }, 'users', {}).then((results) => {
                results.constructor.name.should.eql('Array')
                results[0].name.should.eql('Jim')

                authStore.find({ token: '123456123456123456123456' }, 'token-store', {}).then((results) => {
                  results.constructor.name.should.eql('Array')
                  results[0].token.should.eql('123456123456123456123456')
                  done()
                })
              })
            })
          })
        })
      })
    })
  })
})
