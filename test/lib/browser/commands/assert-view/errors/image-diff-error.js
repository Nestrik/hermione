'use strict';

const AssertViewError = require('lib/browser/commands/assert-view/errors/assert-view-error');
const ImageDiffError = require('lib/browser/commands/assert-view/errors/image-diff-error');

describe('ImageDiffError', () => {
    it('should be an instance of "AssertViewError"', () => {
        assert.instanceOf(new ImageDiffError(), AssertViewError);
    });

    it('should be eventually an instance of Error', () => {
        assert.instanceOf(new ImageDiffError(), Error);
    });

    it('should contain a state name in an error message', () => {
        const error = new ImageDiffError('plain');

        assert.match(error.message, /images are different for "plain" state/);
    });

    it('should contain a state name', () => {
        const error = new ImageDiffError('plain', {});

        assert.equal(error.stateName, 'plain');
    });

    it('should contain a current image path', () => {
        const error = new ImageDiffError('', {currPath: '/curr/path'});

        assert.equal(error.currentImagePath, '/curr/path');
    });

    it('should contain a reference image path', () => {
        const error = new ImageDiffError('plain', {refPath: '/some/path'});

        assert.equal(error.refImagePath, '/some/path');
    });

    it('should contain a function which generates image diff', () => {
        const buildDiffFn = () => 'foo';
        const error = new ImageDiffError('plain', {}, buildDiffFn);

        assert.equal(error.saveDiffTo(), 'foo');
    });
});
