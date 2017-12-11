'use strict';

const fs = require('fs');
const webdriverio = require('webdriverio');
const temp = require('temp');
const Image = require('lib/browser/commands/assert-view/image');
const NoRefImageError = require('lib/browser/commands/assert-view/errors/no-ref-image-error');
const ImageDiffError = require('lib/browser/commands/assert-view/errors/image-diff-error');
const {mkBrowser_, mkSessionStub_} = require('../../utils');

describe('assertView command', () => {
    const sandbox = sinon.sandbox.create();
    let session, imageStub;
    const assertView = (config) => {
        return mkBrowser_(config)
            .init()
            .then(() => session.assertView());
    };

    beforeEach(() => {
        session = mkSessionStub_(sandbox);
        session.screenshot = sandbox.stub().named('screenshot').resolves({value: 'base64hash'});
        session.executionContext = {};
        sandbox.stub(webdriverio, 'remote').returns(session);
        imageStub = {save: sandbox.stub().named('save')};
        sandbox.stub(Image, 'fromBase64').resolves(imageStub);
        sandbox.stub(Image, 'compare');
        sandbox.stub(Image.prototype, 'save').resolves();
        sandbox.stub(fs, 'existsSync');
        sandbox.stub(temp, 'path');
    });

    afterEach(() => sandbox.restore());

    describe('take screenshot', () => {
        beforeEach(() => {
            fs.existsSync.returns(true);
            Image.compare.resolves(true);
        });

        it('should take a screenshot', () => {
            return assertView()
                .then(() => assert.calledOnce(session.screenshot));
        });

        it('should create Image instance from captured screenshot', () => {
            return assertView()
                .then(() => assert.calledOnceWith(Image.fromBase64, 'base64hash'));
        });

        it('should save a captured screenshot', () => {
            temp.path.returns('/curr/path');

            return assertView()
                .then(() => assert.calledOnceWith(imageStub.save, '/curr/path'));
        });
    });

    it('should fail with "NoRefImageError" error if there is no reference image', () => {
        fs.existsSync.returns(false);

        return assert.isRejected(assertView(), NoRefImageError);
    });

    describe('image compare', () => {
        const mkConfig_ = (opts = {}) => {
            return Object.assign({
                getScreenshotPath: () => '/some/path',
                system: {diffColor: '#ffffff'}
            }, opts);
        };

        beforeEach(() => {
            fs.existsSync.returns(true);
        });

        it('should compare a current image with a reference', () => {
            const config = mkConfig_({
                getScreenshotPath: () => '/ref/path',
                tolerance: 100
            });
            Image.compare.resolves(true);
            temp.path.returns('/curr/path');

            return assertView(config)
                .then(() => {
                    assert.calledOnceWith(Image.compare, '/ref/path', '/curr/path', {tolerance: 100});
                });
        });

        describe('if images are not equal', () => {
            beforeEach(() => {
                Image.compare.resolves(false);
                sandbox.stub(Image, 'buildDiff');
            });

            it('should fail with "ImageDiffError" error', () => {
                return assert.isRejected(assertView(mkConfig_()), ImageDiffError);
            });

            it('should extend an error with buildDiff function', () => {
                return assertView(mkConfig_())
                    .catch((error) => {
                        assert.isFunction(error.saveDiffTo);
                    });
            });

            describe('build image diff function', () => {
                const saveDiff = (diffPath = '/diff/path', config) => {
                    return assertView(config)
                        .catch((error) => error.saveDiffTo(diffPath));
                };

                it('should build diff for passed image paths', () => {
                    const config = mkConfig_({getScreenshotPath: () => '/reference/path'});
                    temp.path.returns('/current/path');

                    return saveDiff('/diff/path', config)
                        .then(() => {
                            assert.calledWithMatch(Image.buildDiff, {
                                currPath: '/current/path',
                                diffPath: '/diff/path',
                                refPath: '/reference/path'
                            });
                        });
                });

                it('should build diff with passed compare options', () => {
                    const config = {
                        tolerance: 100,
                        system: {diffColor: '#111111'}
                    };

                    return saveDiff('/diff/path', config)
                        .then(() => {
                            assert.calledWithMatch(Image.buildDiff, {tolerance: 100, diffColor: '#111111'});
                        });
                });
            });
        });
    });
});
