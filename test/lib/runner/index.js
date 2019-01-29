'use strict';

const _ = require('lodash');
const {temp} = require('gemini-core');
const Promise = require('bluebird');

const BrowserPool = require('lib/browser-pool');
const RuntimeConfig = require('lib/config/runtime-config');
const RunnerStats = require('lib/stats');
const RunnerEvents = require('lib/constants/runner-events');
const logger = require('lib/utils/logger');
const Workers = require('lib/runner/workers');
const Runner = require('lib/runner');
const BrowserRunner = require('lib/runner/browser-runner');
const TestCollection = require('lib/test-collection');

const {makeConfigStub} = require('../../utils');

describe('Runner', () => {
    const sandbox = sinon.sandbox.create();

    const run_ = (opts = {}) => {
        const config = opts.config || makeConfigStub();
        const runner = opts.runner || new Runner(config);

        return runner.run(opts.testCollection || TestCollection.create());
    };

    const onRun = (fn) => {
        BrowserRunner.prototype.run.callsFake(function() {
            fn(this);
            return Promise.resolve();
        });
    };

    beforeEach(() => {
        sandbox.stub(Workers.prototype);
        sandbox.stub(Workers, 'create').returns(Object.create(Workers.prototype));

        sandbox.stub(BrowserPool, 'create').returns({cancel: sandbox.spy()});

        sandbox.stub(temp, 'init');
        sandbox.stub(temp, 'serialize');

        sandbox.stub(logger, 'warn');
        sandbox.stub(RuntimeConfig, 'getInstance').returns({extend: () => {}});

        sandbox.stub(TestCollection.prototype);

        sandbox.spy(BrowserRunner, 'create');
        sandbox.stub(BrowserRunner.prototype, 'run').resolves();
        sandbox.stub(BrowserRunner.prototype, 'addTestToRun').resolves();
    });

    afterEach(() => sandbox.restore());

    describe('constructor', () => {
        it('should create browser pool', () => {
            const config = makeConfigStub();
            const runner = new Runner(config);

            assert.calledOnceWith(BrowserPool.create, config, runner);
        });

        it('should init temp with dir from config', () => {
            const config = makeConfigStub({system: {tempDir: 'some/dir'}});

            Runner.create(config);

            assert.calledOnceWith(temp.init, 'some/dir');
        });

        it('should extend runtime config with temp options', () => {
            const extend = sandbox.stub();
            RuntimeConfig.getInstance.returns({extend});

            temp.serialize.returns({some: 'opts'});

            Runner.create(makeConfigStub());

            assert.calledOnceWith(extend, {tempOpts: {some: 'opts'}});
        });
    });

    describe('run', () => {
        beforeEach(() => {
            TestCollection.prototype.getBrowsers.returns(['defaultBrowser']);
        });

        describe('workers', () => {
            it('should create workers', async () => {
                const config = makeConfigStub();
                const runner = new Runner(config);

                await run_({runner});

                assert.calledOnceWith(Workers.create, config);
            });

            it('should create workers before BEGIN event', async () => {
                const onBegin = sinon.stub().named('onBegin').resolves();
                const runner = new Runner(makeConfigStub())
                    .on(RunnerEvents.BEGIN, onBegin);

                await run_({runner});

                assert.callOrder(Workers.create, onBegin);
            });

            it('should pass workers to each browser runner', async () => {
                const workers = Object.create(Workers.prototype);
                Workers.create.returns(workers);

                TestCollection.prototype.getBrowsers.returns(['bro1', 'bro2']);
                await run_();

                assert.alwaysCalledWith(BrowserRunner.create, sinon.match.any, sinon.match.any, sinon.match.any, workers);
            });

            it('should end workers after work is done', async () => {
                await run_();

                assert.calledOnce(Workers.prototype.end);
            });

            it('should end workers on fail', async () => {
                const runner = new Runner(makeConfigStub())
                    .on(RunnerEvents.RUNNER_START, () => Promise.reject('o.O'));

                await run_({runner}).catch(() => {});

                assert.calledOnce(Workers.prototype.end);
            });
        });

        it('should create browser runners for all browsers from config', async () => {
            TestCollection.prototype.getBrowsers.returns(['foo', 'bar']);

            await run_();

            assert.calledTwice(BrowserRunner.create);
            assert.calledWith(BrowserRunner.create, 'foo');
            assert.calledWith(BrowserRunner.create, 'bar');
        });

        it('should pass config to the browser runner', async () => {
            const config = makeConfigStub();

            await run_({config});

            assert.calledOnceWith(BrowserRunner.create, sinon.match.any, config);
        });

        it('should create browser runners with the same browser pool', async () => {
            TestCollection.prototype.getBrowsers.returns(['foo', 'bar']);
            const pool = Object.create(null);

            BrowserPool.create.returns(pool);

            await run_();

            assert.calledTwice(BrowserRunner.create);
            assert.calledWith(BrowserRunner.create, sinon.match.any, sinon.match.any, pool);
            assert.calledWith(BrowserRunner.create, sinon.match.any, sinon.match.any, pool);
        });

        it('should pass test collection to browser runner', async () => {
            const testCollection = TestCollection.create();
            TestCollection.prototype.getBrowsers.returns(['foo']);

            await run_({testCollection});

            assert.calledOnceWith(BrowserRunner.prototype.run, testCollection);
        });

        it('should wait until all browser runners will finish', async () => {
            const firstResolveMarker = sandbox.stub().named('First resolve marker');
            const secondResolveMarker = sandbox.stub().named('Second resolve marker');

            TestCollection.prototype.getBrowsers.returns(['foo', 'bar']);
            BrowserRunner.prototype.run
                .onFirstCall().callsFake(() => Promise.resolve().then(firstResolveMarker))
                .onSecondCall().callsFake(() => Promise.delay(1).then(secondResolveMarker));

            await run_();

            assert.calledOnce(firstResolveMarker);
            assert.calledOnce(secondResolveMarker);
        });

        _.forEach(RunnerEvents.getRunnerSync(), (event, name) => {
            it(`should passthrough ${name} event from browser runner`, async () => {
                onRun((browserRunner) => browserRunner.emit(event, {foo: 'bar'}));

                sandbox.stub(RunnerStats, 'create').returns(sandbox.createStubInstance(RunnerStats));

                const onEvent = sinon.stub().named(`on${name}`);
                const runner = new Runner(makeConfigStub())
                    .on(event, onEvent);

                await run_({runner});

                assert.calledOnceWith(onEvent, {foo: 'bar'});
            });
        });

        describe('interceptors', () => {
            _.forEach(RunnerEvents.getRunnerSync(), (event, name) => {
                it(`should call interceptor for ${name} with event name and event data`, async () => {
                    onRun((browserRunner) => browserRunner.emit(event, {foo: 'bar'}));

                    const handler = sandbox.stub();
                    const runner = new Runner(makeConfigStub(), [{event, handler}]);

                    await run_({runner});

                    assert.calledOnceWith(handler, {event, data: {foo: 'bar'}});
                });

                it(`should intecept ${name} from browser runner`, async () => {
                    onRun((browserRunner) => browserRunner.emit(event));

                    const onEvent = sinon.stub().named(`on${name}`);
                    const onFoo = sinon.stub().named('onFoo');
                    const handler = sandbox.stub().returns({event: 'foo', data: {baz: 'qux'}});
                    const runner = new Runner(makeConfigStub(), [{event, handler}])
                        .on(event, onEvent)
                        .on('foo', onFoo);

                    await run_({runner});

                    assert.notCalled(onEvent);
                    assert.calledOnceWith(onFoo, {baz: 'qux'});
                });
            });

            it('should passthrough event if interceptor returns falsey value', async () => {
                onRun((browserRunner) => browserRunner.emit('eventName', {foo: 'bar'}));

                const onEvent = sinon.stub().named('onEvent');
                const interceptor = {event: 'eventName', handler: sandbox.stub().returns()};
                const runner = new Runner(makeConfigStub(), [interceptor])
                    .on('eventName', onEvent);

                await run_({runner});

                assert.calledOnceWith(onEvent, {foo: 'bar'});
            });

            it('should not emit event if interceptor returns an empty object', async () => {
                onRun((browserRunner) => browserRunner.emit('eventName'));

                const onEvent = sinon.stub().named('onEvent');
                const interceptor = {event: 'eventName', handler: sandbox.stub().returns({})};
                const runner = new Runner(makeConfigStub(), [interceptor])
                    .on('eventName', onEvent);

                await run_({runner});

                assert.notCalled(onEvent);
            });

            it('should passthrough event if interceptor returns the same event', async () => {
                onRun((browserRunner) => browserRunner.emit('eventName', {foo: 'bar'}));

                const onEvent = sinon.stub().named(`onEvent`);
                const handler = sandbox.stub().returns({event: 'eventName', data: {baz: 'qux'}});
                const interceptor = {event: 'eventName', handler};
                const runner = new Runner(makeConfigStub(), [interceptor])
                    .on('eventName', onEvent);

                await run_({runner});

                assert.calledOnceWith(onEvent, {baz: 'qux'});
            });

            it('should apply all event interceptors', async () => {
                onRun((browserRunner) => browserRunner.emit('eventName'));

                const onEvent = sinon.stub().named(`onEvent`);
                const onFoo = sinon.stub().named('onFoo');
                const interceptor1 = {event: 'eventName', handler: sandbox.stub().returns({event: 'eventName'})};
                const interceptor2 = {event: 'eventName', handler: sandbox.stub().returns({event: 'foo'})};
                const runner = new Runner(makeConfigStub(), [interceptor1, interceptor2])
                    .on('eventName', onEvent)
                    .on('foo', onFoo);

                await run_({runner});

                assert.notCalled(onEvent);
                assert.calledOnce(onFoo);
            });

            it('should apply appropriate event interceptors from the list of all ones', async () => {
                onRun((browserRunner) => browserRunner.emit('eventName'));

                const onEvent = sinon.stub().named(`onEvent`);
                const onFoo = sinon.stub().named('onFoo');
                const interceptor1 = {event: 'eventName', handler: sandbox.stub().returns({event: 'onFoo'})};
                const interceptor2 = {event: 'anotherEvent', handler: sandbox.stub()};
                const runner = new Runner(makeConfigStub(), [interceptor1, interceptor2])
                    .on('eventName', onEvent)
                    .on('onFoo', onFoo);

                await run_({runner});

                assert.notCalled(onEvent);
                assert.calledOnce(onFoo);
            });

            it('should pass events between interceptors', async () => {
                onRun((browserRunner) => browserRunner.emit('eventName'));

                const onEvent = sinon.stub().named(`onEvent`);
                const onFoo = sinon.stub().named('onFoo');
                const onBar = sinon.stub().named('onBar');
                const interceptor1 = {event: 'eventName', handler: sandbox.stub().returns({event: 'foo'})};
                const interceptor2 = {event: 'foo', handler: sandbox.stub().returns({event: 'bar'})};
                const runner = new Runner(makeConfigStub(), [interceptor1, interceptor2])
                    .on('eventName', onEvent)
                    .on('foo', onFoo)
                    .on('bar', onBar);

                await run_({runner});

                assert.notCalled(onEvent);
                assert.notCalled(onFoo);
                assert.calledOnce(onBar);
            });

            it('should handle cycles when passing events between interceptors', async () => {
                onRun((browserRunner) => browserRunner.emit('eventName'));

                const onEvent = sinon.stub().named(`onEvent`);
                const onFoo = sinon.stub().named('onFoo');
                const interceptor1 = {event: 'eventName', handler: sandbox.stub().returns({event: 'onFoo'})};
                const interceptor2 = {event: 'onFoo', handler: sandbox.stub().returns({event: 'eventName'})};
                const runner = new Runner(makeConfigStub(), [interceptor1, interceptor2])
                    .on('eventName', onEvent)
                    .on('foo', onFoo);

                await run_({runner});

                assert.notCalled(onFoo);
                assert.calledOnce(onEvent);
            });

            it('should handle errors from interceptor callback', async () => {
                onRun((browserRunner) => browserRunner.emit('eventName'));

                const onEvent = sinon.stub().named('onEvent');
                const onError = sinon.stub().named('onError');
                const err = new Error();
                const runner = new Runner(makeConfigStub(), [{event: 'eventName', handler: sandbox.stub().throws(err)}])
                    .on('eventName', onEvent)
                    .on(RunnerEvents.ERROR, onError);

                await run_({runner});

                assert.calledOnceWith(onError, err);
            });
        });

        describe('END event', () => {
            it('should be emitted after browser runners finish', async () => {
                const onEnd = sinon.spy().named('onEnd');

                const runner = new Runner(makeConfigStub())
                    .on(RunnerEvents.END, onEnd);

                await run_({runner});

                assert.callOrder(BrowserRunner.prototype.run, onEnd);
            });

            it('should be emitted even if some browser runner failed', async () => {
                const onEnd = sinon.spy().named('onEnd');
                const runner = new Runner(makeConfigStub())
                    .on(RunnerEvents.END, onEnd);

                BrowserRunner.prototype.run.callsFake(() => Promise.reject());

                await run_({runner}).catch(() => {});

                assert.calledOnce(onEnd);
            });
        });
    });

    describe('addTestToRun', () => {
        beforeEach(() => {
            TestCollection.prototype.getBrowsers.returns([]);
        });

        it('should create new browser runner if there is no active one', async () => {
            const config = makeConfigStub({browser: ['bro1']});
            const pool = {};
            BrowserPool.create.returns(pool);
            const workers = Object.create(Workers.prototype);
            Workers.create.returns(workers);
            const runner = new Runner(config);
            const test = {};
            await run_({runner});

            runner.addTestToRun(test, 'bro2');

            assert.calledOnceWith(BrowserRunner.create, 'bro2', config, pool, workers);
            assert.calledOnceWith(BrowserRunner.prototype.run, TestCollection.create({bro2: [test]}));
        });

        it('should pass test to the browser runner', async () => {
            const runner = new Runner(makeConfigStub());
            const test = {};

            sandbox.stub(BrowserRunner.prototype, 'browserId').get(() => 'bro');
            BrowserRunner.prototype.run.callsFake(() => runner.addTestToRun(test, 'bro'));
            TestCollection.prototype.getBrowsers.returns(['bro']);

            await run_({runner});

            assert.calledWith(BrowserRunner.prototype.addTestToRun, test);
        });

        it('should return false when runner is not running', async () => {
            const runner = new Runner(makeConfigStub());

            const added = runner.addTestToRun({});

            assert.isFalse(added);
            assert.notCalled(BrowserRunner.prototype.addTestToRun);
            assert.notCalled(BrowserRunner.prototype.run);
        });

        it('should return false when workers are ended', async () => {
            const runner = new Runner(makeConfigStub());
            await run_({runner});
            Workers.prototype.isEnded.returns(true);

            const added = runner.addTestToRun({});

            assert.isFalse(added);
            assert.notCalled(BrowserRunner.prototype.addTestToRun);
            assert.notCalled(BrowserRunner.prototype.run);
        });

        it('should return false when runner is cancelled', async () => {
            const runner = new Runner(makeConfigStub());
            run_({runner});

            runner.cancel();
            const added = runner.addTestToRun({});

            assert.isFalse(added);
            assert.notCalled(BrowserRunner.prototype.addTestToRun);
            assert.notCalled(BrowserRunner.prototype.run);
        });
    });

    describe('cancel', () => {
        let cancelStub;

        beforeEach(() => {
            cancelStub = sandbox.stub();
            BrowserPool.create.returns({cancel: cancelStub});

            sandbox.stub(BrowserRunner.prototype, 'cancel');
        });

        it('should cancel browser pool', () => {
            const runner = new Runner(makeConfigStub());

            runner.cancel();

            assert.calledOnce(cancelStub);
        });

        it('should cancel all executing browser runners', async () => {
            TestCollection.prototype.getBrowsers.returns(['foo', 'bar']);

            const runner = new Runner(makeConfigStub());

            BrowserRunner.prototype.run.onSecondCall().callsFake(() => {
                runner.cancel();
                return Promise.resolve();
            });

            await run_({runner});

            assert.calledTwice(BrowserRunner.prototype.cancel);
        });

        it('should not cancel finished browser runner', async () => {
            TestCollection.prototype.getBrowsers.returns(['foo', 'bar']);

            const runner = new Runner(makeConfigStub());

            await run_({runner});
            runner.cancel();

            assert.notCalled(BrowserRunner.prototype.cancel);
        });

        it('shuld not run browser runners if cancelled', async () => {
            TestCollection.prototype.getBrowsers.returns(['foo', 'bar']);

            const runner = new Runner(makeConfigStub())
                .on(RunnerEvents.BEGIN, () => runner.cancel());

            await run_({runner});

            assert.notCalled(BrowserRunner.prototype.run);
            assert.notCalled(BrowserRunner.prototype.cancel);
        });
    });
});
