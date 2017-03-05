var ERR = require('async-stacktrace');
var _ = require('lodash');
var assert = require('assert');
var should = require('should');
var request = require('request');
var cheerio = require('cheerio');

var config = require('../lib/config');
var sqldb = require('../lib/sqldb');
var sqlLoader = require('../lib/sql-loader');
var sql = sqlLoader.loadSqlEquiv(__filename);

var testHelperServer = require('./testHelperServer');

var siteUrl = 'http://localhost:' + config.serverPort;
var baseUrl = siteUrl + '/pl';
var courseInstanceBaseUrl = baseUrl + '/course_instance/1';
var assessmentsUrl = courseInstanceBaseUrl + '/assessments';
var assessmentUrl, assessmentInstanceUrl, q1Url, q2Url;

describe('Homework assessment', function() {

    before("set up testing server", testHelperServer.before);
    after("shut down testing server", testHelperServer.after);

    var res, page, $, elemList;
    var assessment_id, assessment_instance, instance_questions, variant, submission;
    var csrfToken, instance_question, instance_question_1_id, instance_question_2_id;
    var locals = {};

    describe('database', function() {
        it('should contain HW1', function(callback) {
            sqldb.queryOneRow(sql.select_hw1, [], function(err, result) {
                if (ERR(err, callback)) return;
                assessment_id = result.rows[0].id;
                callback(null);
            });
        });
    });

    describe('GET /pl/assessments', function() {
        it('should load successfully', function(callback) {
            request(assessmentsUrl, function (error, response, body) {
                if (error) {
                    return callback(error);
                }
                if (response.statusCode != 200) {
                    return callback(new Error('bad status: ' + response.statusCode));
                }
                res = response;
                page = body;
                callback(null);
            })
        });
        it('should parse', function() {
            $ = cheerio.load(page);
        });
        it('should contain HW1', function() {
            elemList = $('td a:contains("HW1")');
            assert.ok(elemList.length);
        });
        it('should have the correct link for HW1', function() {
            assessmentUrl = siteUrl + elemList[0].attribs.href;
            assert.equal(assessmentUrl, courseInstanceBaseUrl + '/assessment/' + assessment_id + '/');
        });
    });

    describe('GET to assessment URL', function() {
        it('should load successfully', function(callback) {
            request(assessmentUrl, function (error, response, body) {
                if (error) {
                    return callback(error);
                }
                if (response.statusCode != 200) {
                    return callback(new Error('bad status: ' + response.statusCode));
                }
                res = response;
                page = body;
                callback(null);
            })
        });
        it('should redirect to the correct path', function() {
            assessmentInstanceUrl = siteUrl + res.req.path;
            assert.equal(res.req.path, '/pl/course_instance/1/assessment_instance/1');
        });
        it('should create one assessment_instance', function(callback) {
            sqldb.query(sql.select_assessment_instances, [], function(err, result) {
                if (ERR(err, callback)) return;
                if (result.rowCount != 1) {
                    return callback(new Error('expected one assessment_instance, got: ' + result.rowCount));
                }
                assessment_instance = result.rows[0];
                callback(null);
            });
        });
        it('should have the correct assessment_instance.assessment_id', function() {
            assert.equal(assessment_instance.assessment_id, assessment_id);
        });
        it('should create two instance_questions', function(callback) {
            sqldb.query(sql.select_instance_questions, [], function(err, result) {
                if (ERR(err, callback)) return;
                if (result.rowCount != 2) {
                    return callback(new Error('expected two instance_questions, got: ' + result.rowCount));
                }
                instance_questions = result.rows;
                callback(null);
            });
        });
        it('should have the correct first question', function() {
            assert.equal(instance_questions[0].qid, 'addVectors');
            instance_question_1_id = instance_questions[0].id;
        });
        it('should have the correct second question', function() {
            assert.equal(instance_questions[1].qid, 'fossilFuelsRadio');
            instance_question_2_id = instance_questions[1].id;
        });
    });

    describe('GET to assessment_instance URL', function() {
        it('should load successfully', function(callback) {
            request(assessmentInstanceUrl, function (error, response, body) {
                if (error) {
                    return callback(error);
                }
                if (response.statusCode != 200) {
                    return callback(new Error('bad status: ' + response.statusCode));
                }
                res = response;
                page = body;
                callback(null);
            })
        });
        it('should parse', function() {
            $ = cheerio.load(page);
        });
        it('should link to addVectors question', function() {
            elemList = $('td a:contains("Addition of vectors in Cartesian coordinates")');
            elemList.length.should.equal(1);
            q1Url = siteUrl + elemList[0].attribs.href;
            assert.equal(q1Url, courseInstanceBaseUrl + '/instance_question/' + instance_questions[0].id + '/');
        });
        it('should link to fossilFuelsRadio question', function() {
            elemList = $('td a:contains("Advantages of fossil fuels (radio)")');
            elemList.length.should.equal(1);
            q2Url = siteUrl + elemList[0].attribs.href;
            assert.equal(q2Url, courseInstanceBaseUrl + '/instance_question/' + instance_questions[1].id + '/');
        });
    });

    var doSubmission = function() {
        describe('GET to instance_question URL', function() {
            it('should load successfully', function(callback) {
                var instanceQuestionUrl = courseInstanceBaseUrl + '/instance_question/' + locals.instance_question_id;
                request(instanceQuestionUrl, function (error, response, body) {
                    if (error) {
                        return callback(error);
                    }
                    if (response.statusCode != 200) {
                        return callback(new Error('bad status: ' + response.statusCode));
                    }
                    res = response;
                    page = body;
                    callback(null);
                })
            });
            it('should parse', function() {
                $ = cheerio.load(page);
            });
            it('should contain question-data', function() {
                elemList = $('.question-data');
                elemList.length.should.equal(1);
            });
            it('question-data should contain base64 data', function() {
                should.exist(elemList[0].children);
                should.exist(elemList[0].children[0]);
                should.exist(elemList[0].children[0].data);
            });
            it('base64 data should parse to JSON', function() {
                questionData = JSON.parse(new Buffer(elemList[0].children[0].data, 'base64').toString());
            });
            it('should have a variant_id in the questionData', function() {
                questionData.should.have.property('variant');
                variant = questionData.variant;
                variant.should.have.property('id');
            });
            it('should have the variant in the DB', function(callback) {
                var params = {
                    variant_id: variant.id,
                    instance_question_id: variant.instance_question_id,
                };
                sqldb.queryOneRow(sql.select_variant, params, function(err, result) {
                    if (ERR(err, callback)) return;
                    variant = result.rows[0];
                    callback(null);
                });
            });
            it('should have the correct variant.instance_question_id', function() {
                assert.equal(variant.instance_question_id, locals.instance_question_id);
            });
            it('should have a CSRF token', function() {
                elemList = $('.question-form input[name="csrfToken"]');
                elemList.length.should.equal(1);
                elemList[0].should.have.property('attribs');
                elemList[0].attribs.should.have.property('value');
                csrfToken = elemList[0].attribs.value;
                csrfToken.should.be.a.String();
                csrfToken.length.should.be.above(10);
            });
        });
        describe('POST to instance_question URL', function() {
            it('should generate the submittedAnswer', function() {
                submittedAnswer = locals.getSubmittedAnswer(variant);
            });
            it('should load successfully', function(callback) {
                var instanceQuestionUrl = courseInstanceBaseUrl + '/instance_question/' + locals.instance_question_id;
                var form = {
                    postAction: 'submitQuestionAnswer',
                    csrfToken: csrfToken,
                    postData: JSON.stringify({variant, submittedAnswer}),
                };
                request.post({url: instanceQuestionUrl, form: form, followAllRedirects: true}, function (error, response, body) {
                    if (error) {
                        return callback(error);
                    }
                    if (response.statusCode != 200) {
                        return callback(new Error('bad status: ' + response.statusCode));
                    }
                    res = response;
                    page = body;
                    callback(null);
                })
            });
            it('should parse', function() {
                $ = cheerio.load(page);
            });
            it('should create one submission', function(callback) {
                var params = {variant_id: variant.id};
                sqldb.query(sql.select_submission_for_variant, params, function(err, result) {
                    if (ERR(err, callback)) return;
                    if (result.rowCount != 1) {
                        return callback(new Error('expected one submission, got: ' + result.rowCount));
                    }
                    submission = result.rows[0];
                    callback(null);
                });
            });
            it('should have the correct submission.variant_id', function() {
                assert.equal(submission.variant_id, variant.id);
            });
            it('should be graded with expected score', function() {
                assert.equal(submission.score, locals.expectedResult.submission_score);
            });
            it('should be graded with expected correctness', function() {
                assert.equal(submission.correct, locals.expectedResult.submission_correct);
            });
            it('should still have the instance_question', function(callback) {
                var params = {
                    instance_question_id: locals.instance_question_id,
                };
                sqldb.queryOneRow(sql.select_instance_question, params, function(err, result) {
                    if (ERR(err, callback)) return;
                    instance_question = result.rows[0];
                    callback(null);
                });
            });
            it('should update instance_question points', function() {
                instance_question.points.should.equal(locals.expectedResult.instance_question_points);
            });
            it('should update instance_question score_perc', function() {
                instance_question.score_perc.should.be.approximately(locals.expectedResult.instance_question_score_perc, 1e-6);
            });
            it('should still have the assessment_instance', function(callback) {
                var params = {
                    assessment_instance_id: assessment_instance.id,
                };
                sqldb.queryOneRow(sql.select_assessment_instance, params, function(err, result) {
                    if (ERR(err, callback)) return;
                    assessment_instance = result.rows[0];
                    callback(null);
                });
            });
            it('should update assessment_instance points', function() {
                assessment_instance.points.should.equal(locals.expectedResult.assessment_instance_points);
            });
            it('should update assessment_instance score_perc', function() {
                assessment_instance.score_perc.should.be.approximately(locals.expectedResult.assessment_instance_score_perc, 1e-6);
            });
        });
    };

    describe('1. submit correct answer to question 1', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals = {
                    instance_question_id: instance_questions[0].id,
                    expectedResult: {
                        submission_score: 1,
                        submission_correct: true,
                        instance_question_points: 1,
                        instance_question_score_perc: 1/5 * 100,
                        assessment_instance_points: 1,
                        assessment_instance_score_perc: 1/15 * 100,
                    },
                    getSubmittedAnswer: function(variant) {
                        return {
                            wx: variant.true_answer.wx,
                            wy: variant.true_answer.wy,
                        };
                    },
                };
            });
        });
        doSubmission();
    });

    describe('2. submit correct answer to question 2', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals = {
                    instance_question_id: instance_questions[1].id,
                    expectedResult: {
                        submission_score: 1,
                        submission_correct: true,
                        instance_question_points: 2,
                        instance_question_score_perc: 2/10 * 100,
                        assessment_instance_points: 3,
                        assessment_instance_score_perc: 3/15 * 100,
                    },
                    getSubmittedAnswer: function(variant) {
                        return {
                            key: variant.true_answer.key,
                        };
                    },
                };
            });
        });
        doSubmission();
    });

    describe('3. submit incorrect answer to question 1', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals = {
                    instance_question_id: instance_questions[0].id,
                    expectedResult: {
                        submission_score: 0,
                        submission_correct: false,
                        instance_question_points: 1,
                        instance_question_score_perc: 1/5 * 100,
                        assessment_instance_points: 3,
                        assessment_instance_score_perc: 3/15 * 100,
                    },
                    getSubmittedAnswer: function(variant) {
                        return {
                            wx: 400,
                            wy: -700,
                        };
                    },
                };
            });
        });
        doSubmission();
    });

    describe('4. submit correct answer to question 1', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals = {
                    instance_question_id: instance_questions[0].id,
                    expectedResult: {
                        submission_score: 1,
                        submission_correct: true,
                        instance_question_points: 2,
                        instance_question_score_perc: 2/5 * 100,
                        assessment_instance_points: 4,
                        assessment_instance_score_perc: 4/15 * 100,
                    },
                    getSubmittedAnswer: function(variant) {
                        return {
                            wx: variant.true_answer.wx,
                            wy: variant.true_answer.wy,
                        };
                    },
                };
            });
        });
        doSubmission();
    });

    describe('5. submit correct answer to question 1', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals = {
                    instance_question_id: instance_questions[0].id,
                    expectedResult: {
                        submission_score: 1,
                        submission_correct: true,
                        instance_question_points: 4,
                        instance_question_score_perc: 4/5 * 100,
                        assessment_instance_points: 6,
                        assessment_instance_score_perc: 6/15 * 100,
                    },
                    getSubmittedAnswer: function(variant) {
                        return {
                            wx: variant.true_answer.wx,
                            wy: variant.true_answer.wy,
                        };
                    },
                };
            });
        });
        doSubmission();
    });

    describe('6. submit correct answer to question 1', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals = {
                    instance_question_id: instance_questions[0].id,
                    expectedResult: {
                        submission_score: 1,
                        submission_correct: true,
                        instance_question_points: 5,
                        instance_question_score_perc: 5/5 * 100,
                        assessment_instance_points: 7,
                        assessment_instance_score_perc: 7/15 * 100,
                    },
                    getSubmittedAnswer: function(variant) {
                        return {
                            wx: variant.true_answer.wx,
                            wy: variant.true_answer.wy,
                        };
                    },
                };
            });
        });
        doSubmission();
    });

    describe('7. submit correct answer to question 2', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals = {
                    instance_question_id: instance_questions[1].id,
                    expectedResult: {
                        submission_score: 1,
                        submission_correct: true,
                        instance_question_points: 6,
                        instance_question_score_perc: 6/10 * 100,
                        assessment_instance_points: 11,
                        assessment_instance_score_perc: 11/15 * 100,
                    },
                    getSubmittedAnswer: function(variant) {
                        return {
                            key: variant.true_answer.key,
                        };
                    },
                };
            });
        });
        doSubmission();
    });

    describe('8. submit incorrect answer to question 2', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals = {
                    instance_question_id: instance_questions[1].id,
                    expectedResult: {
                        submission_score: 0,
                        submission_correct: false,
                        instance_question_points: 6,
                        instance_question_score_perc: 6/10 * 100,
                        assessment_instance_points: 11,
                        assessment_instance_score_perc: 11/15 * 100,
                    },
                    getSubmittedAnswer: function(variant) {
                        return {
                            key: (variant.true_answer.key == 'a') ? 'b' : 'a',
                        };
                    },
                };
            });
        });
        doSubmission();
    });

    describe('9. submit correct answer to question 2', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals = {
                    instance_question_id: instance_questions[1].id,
                    expectedResult: {
                        submission_score: 1,
                        submission_correct: true,
                        instance_question_points: 8,
                        instance_question_score_perc: 8/10 * 100,
                        assessment_instance_points: 13,
                        assessment_instance_score_perc: 13/15 * 100,
                    },
                    getSubmittedAnswer: function(variant) {
                        return {
                            key: variant.true_answer.key,
                        };
                    },
                };
            });
        });
        doSubmission();
    });

    describe('10. submit correct answer to question 2', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals = {
                    instance_question_id: instance_questions[1].id,
                    expectedResult: {
                        submission_score: 1,
                        submission_correct: true,
                        instance_question_points: 10,
                        instance_question_score_perc: 10/10 * 100,
                        assessment_instance_points: 15,
                        assessment_instance_score_perc: 15/15 * 100,
                    },
                    getSubmittedAnswer: function(variant) {
                        return {
                            key: variant.true_answer.key,
                        };
                    },
                };
            });
        });
        doSubmission();
    });

    describe('11. submit correct answer to question 2', function() {
        describe('setting up the submission data', function() {
            it('should succeed', function() {
                locals = {
                    instance_question_id: instance_questions[1].id,
                    expectedResult: {
                        submission_score: 1,
                        submission_correct: true,
                        instance_question_points: 10,
                        instance_question_score_perc: 10/10 * 100,
                        assessment_instance_points: 15,
                        assessment_instance_score_perc: 15/15 * 100,
                    },
                    getSubmittedAnswer: function(variant) {
                        return {
                            key: variant.true_answer.key,
                        };
                    },
                };
            });
        });
        doSubmission();
    });
});
