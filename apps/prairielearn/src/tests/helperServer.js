const util = require('util');
const ERR = require('async-stacktrace');
const async = require('async');
const tmp = require('tmp-promise');
const path = require('path');
const { setTimeout: sleep } = require('node:timers/promises');
const assert = require('chai').assert;
const debug = require('debug')('prairielearn:' + path.basename(__filename, '.js'));
const opentelemetry = require('@prairielearn/opentelemetry');

const assets = require('../lib/assets');
const { config } = require('../lib/config');
const load = require('../lib/load');
const cron = require('../cron');
const socketServer = require('../lib/socket-server');
const serverJobs = require('../lib/server-jobs-legacy');
const freeformServer = require('../question-servers/freeform');
const cache = require('../lib/cache');
const localCache = require('../lib/local-cache');
const codeCaller = require('../lib/code-caller');
const externalGrader = require('../lib/externalGrader');
const externalGradingSocket = require('../lib/externalGradingSocket');
const { TEST_COURSE_PATH } = require('../lib/paths');

const sqldb = require('@prairielearn/postgres');
const sql = sqldb.loadSqlEquiv(__filename);

config.startServer = false;
// Pick a unique port based on the Mocha worker ID.
config.serverPort = 3007 + Number.parseInt(process.env.MOCHA_WORKER_ID ?? '0', 10);
const server = require('../server');

const helperDb = require('./helperDb');
const helperCourse = require('./helperCourse');

module.exports = {
  before: (courseDir) => {
    courseDir ??= TEST_COURSE_PATH;

    return function (callback) {
      debug('before()');
      let httpServer;
      async.series(
        [
          // We (currently) don't ever want tracing to run during tests.
          async () => opentelemetry.init({ openTelemetryEnabled: false }),
          async () => {
            debug('before(): initializing DB');
            // pass "this" explicitly to enable this.timeout() calls
            await helperDb.before.call(this);
          },
          async () => {
            debug('before(): create tmp dir for config.filesRoot');
            const tmpDir = await tmp.dir({ unsafeCleanup: true });
            config.filesRoot = tmpDir.path;
          },
          async () => {
            debug('before(): initializing cron');
            cron.init();
          },
          function (callback) {
            debug('before(): inserting dev user');
            server.insertDevUser(function (err) {
              if (ERR(err, callback)) return;
              callback(null);
            });
          },
          async () => {
            debug('before(): sync from disk');
            await helperCourse.syncCourse(courseDir);
          },
          function (callback) {
            debug('before(): set up load estimators');
            load.initEstimator('request', 1);
            load.initEstimator('authed_request', 1);
            load.initEstimator('python', 1);
            callback(null);
          },
          async function () {
            debug('before(): initialize code callers');
            await codeCaller.init();
          },
          async () => assets.init(),
          async () => {
            debug('before(): start server');
            httpServer = await server.startServer();
          },
          async () => {
            debug('before(): initialize socket server');
            socketServer.init(httpServer);
          },
          async () => {
            debug('before(): initialize cache');
            await cache.init();
          },
          async () => {
            debug('before(): initialize server jobs');
            serverJobs.init();
          },
          async () => {
            debug('before(): initialize freeform server');
            await freeformServer.init();
          },
          function (callback) {
            externalGrader.init(function (err) {
              if (ERR(err, callback)) return;
              callback(null);
            });
          },
          function (callback) {
            externalGradingSocket.init(function (err) {
              if (ERR(err, callback)) return;
              callback(null);
            });
          },
        ],
        function (err) {
          debug('before(): completed');
          if (ERR(err, callback)) return;
          callback(null);
        },
      );
    };
  },

  after: function (callback) {
    debug('after()');
    // call close()/stop() functions in reverse order to the
    // start() functions above
    async.series(
      [
        async () => assets.close(),
        async function () {
          debug('after(): finish workers');
          await codeCaller.finish();
        },
        function (callback) {
          debug('after(): stop server');
          server.stopServer(function (err) {
            if (ERR(err, callback)) return;
            callback(null);
          });
        },
        async () => {
          debug('after(): close load estimators');
          load.close();
        },
        async () => {
          debug('after(): stop cron');
          await cron.stop();
        },
        async () => {
          debug('after(): close socket server');
          await socketServer.close();
        },
        async () => {
          debug('after(): close server jobs');
          await serverJobs.stop();
        },
        async () => {
          debug('after(): close cache');
          await cache.close();
        },
        function (callback) {
          debug('after(): close local cache');
          localCache.close();
          callback(null);
        },
        async () => {
          debug('after(): finish DB');
          await helperDb.after.call(this);
        },
      ],
      function (err) {
        debug('after(): complete');
        if (ERR(err, callback)) return;
        callback(null);
      },
    );
  },
};

module.exports.getLastJobSequenceIdAsync = async () => {
  const result = await sqldb.queryZeroOrOneRowAsync(sql.select_last_job_sequence, []);
  if (result.rowCount === 0) {
    throw new Error('Could not find last job_sequence_id: did the job start?');
  }
  const job_sequence_id = result.rows[0].id;
  return job_sequence_id;
};
module.exports.getLastJobSequenceId = util.callbackify(module.exports.getLastJobSequenceIdAsync);

module.exports.waitForJobSequenceAsync = async (job_sequence_id) => {
  let job_sequence;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await sqldb.queryOneRowAsync(sql.select_job_sequence, {
      job_sequence_id,
    });
    job_sequence = result.rows[0];
    if (job_sequence.status !== 'Running') break;
    await sleep(10);
  }
  return job_sequence;
};
module.exports.waitForJobSequence = util.callbackify(module.exports.waitForJobSequenceAsync);

module.exports.waitForJobSequenceSuccessAsync = async (job_sequence_id) => {
  const job_sequence = await module.exports.waitForJobSequenceAsync(job_sequence_id);

  // In the case of a failure, print more information to aid debugging.
  if (job_sequence.status !== 'Success') {
    console.log(job_sequence);
    const result = await sqldb.queryAsync(sql.select_jobs, { job_sequence_id });
    console.log(result.rows);
  }

  assert.equal(job_sequence.status, 'Success');
};
module.exports.waitForJobSequenceSuccess = util.callbackify(
  module.exports.waitForJobSequenceSuccessAsync,
);
