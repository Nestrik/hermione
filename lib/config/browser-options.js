'use strict';

const _ = require('lodash');
const option = require('gemini-configparser').option;
const defaults = require('./defaults');
const optionsBuilder = require('./options-builder');
const utils = require('./utils');

const is = utils.is;

exports.getTopLevel = () => {
    const provideDefault = _.propertyOf(defaults);

    return buildBrowserOptions(provideDefault, {
        desiredCapabilities: optionsBuilder(provideDefault).optionalObject('desiredCapabilities')
    });
};

exports.getPerBrowser = () => {
    return buildBrowserOptions(provideTopLevelDefault, {
        desiredCapabilities: option({
            defaultValue: defaults.desiredCapabilities,
            parseEnv: JSON.parse,
            parseCli: JSON.parse,
            validate: (value, config) => {
                if (_.isNull(value) && _.isNull(config.desiredCapabilities)) {
                    throw new Error('Each browser must have "desiredCapabilities" option');
                } else {
                    utils.assertOptionalObject(value, 'desiredCapabilities');
                }
            },
            map: (value, config) => _.extend({}, config.desiredCapabilities, value)
        })
    });
};

function provideTopLevelDefault(name) {
    return (config) => {
        const value = config[name];

        if (_.isUndefined(value)) {
            throw new Error(`"${name}" should be set at the top level or per-browser option`);
        }

        return value;
    };
}

function buildBrowserOptions(defaultFactory, extra) {
    const options = optionsBuilder(defaultFactory);

    return _.extend(extra, {
        gridUrl: options.string('gridUrl'),

        baseUrl: option({
            defaultValue: defaultFactory('baseUrl'),
            validate: is('string', 'baseUrl'),
            map: (value, config) => {
                return config.baseUrl && !value.match(/^https?:\/\//)
                    ? [config.baseUrl.replace(/\/$/, ''), value.replace(/^\//, '')].join('/')
                    : value;
            }
        }),

        sessionsPerBrowser: options.positiveInteger('sessionsPerBrowser'),
        testsPerSession: options.positiveIntegerOrInfinity('testsPerSession'),

        retry: options.nonNegativeInteger('retry'),

        httpTimeout: options.nonNegativeInteger('httpTimeout'),
        sessionRequestTimeout: options.optionalNonNegativeInteger('sessionRequestTimeout'),
        sessionQuitTimeout: options.optionalNonNegativeInteger('sessionQuitTimeout'),
        waitTimeout: options.positiveInteger('waitTimeout'),

        prepareBrowser: options.optionalFunction('prepareBrowser'),

        screenshotPath: option({
            defaultValue: defaultFactory('screenshotPath'),
            validate: (value) => _.isNull(value) || is('string', 'screenshotPath')(value),
            map: utils.resolveWithProjectDir
        }),

        screenshotsDir: options.stringOrFunction('screenshotsDir'),

        tolerance: option({
            defaultValue: defaultFactory('tolerance'),
            parseEnv: Number,
            parseCli: Number,
            validate: (value) => utils.assertNonNegativeNumber(value, 'tolerance')
        }),

        meta: options.optionalObject('meta'),

        windowSize: option({
            defaultValue: defaultFactory('windowSize'),
            validate: (value) => {
                if (_.isNull(value)) {
                    return;
                }
                if (_.isObject(value)) {
                    if (_.isNumber(value.width) && _.isNumber(value.height)) {
                        return;
                    } else {
                        throw new Error('"windowSize" must be an object with "width" and "height" keys');
                    }
                }
                if (!_.isString(value)) {
                    throw new Error('"windowSize" must be string, object or null');
                } else if (!/^\d+x\d+$/.test(value)) {
                    throw new Error('"windowSize" should have form of <width>x<height> (i.e. 1600x1200)');
                }
            },
            map: (value) => {
                if (_.isNull(value) || _.isObject(value)) {
                    return value;
                }

                const [width, height] = value.split('x').map((v) => parseInt(v, 10));

                return {width, height};
            }
        })
    });
}
