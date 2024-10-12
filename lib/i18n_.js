var i18n = require('i18n');

i18n.configure({
    locales: ['ko', 'en'],
    directory: __dirname + '/locales',
    defaultLocale: 'ko',
    cookie: 'lang'
});

module.exports = i18n;

// Multi-Language library