'use strict';

const _ = require('lodash');
const q = require('q');
const Browser = require('../../../lib/browser');

function createBrowserConfig_(opts = {}) {
    const browser = _.defaults(opts, {
        desiredCapabilities: {browserName: 'browser'},
        baseUrl: 'http://base_url',
        gridUrl: 'http://test_host:4444/wd/hub',
        waitTimeout: 100,
        screenshotPath: 'path/to/screenshots',
        screenshotOnReject: true,
        httpTimeout: 3000,
        sessionRequestTimeout: null,
        sessionQuitTimeout: null,
        windowSize: null,
        getScreenshotPath: () => '/some/path',
        system: opts.system || {}
    });

    return {
        baseUrl: 'http://main_url',
        gridUrl: 'http://main_host:4444/wd/hub',
        system: {debug: true},
        forBrowser: () => browser
    };
}

exports.mkBrowser_ = (opts) => {
    return new Browser(createBrowserConfig_(opts), 'browser');
};

exports.mkSessionStub_ = (sandbox) => {
    const session = q();
    session.init = sandbox.stub().named('init').returns(session);
    session.end = sandbox.stub().named('end').resolves();
    session.url = sandbox.stub().named('url').returns(session);
    session.windowHandleSize = sandbox.stub().named('windowHandleSize').resolves({value: {}});
    session.requestHandler = {defaultOptions: {}};

    session.addCommand = sinon.stub().callsFake((name, command) => {
        session[name] = command;
        sandbox.spy(session, name);
    });

    return session;
};
