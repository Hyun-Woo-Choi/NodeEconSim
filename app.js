var express = require('express');
var path = require('path');
var helmet = require("helmet");
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var logger = require('morgan');
var session = require('express-session')
var FileStore = require('session-file-store')(session)
const requestIp = require('request-ip');
// var favicon = require('serve-favicon')

var i18nSetting = require('./lib/i18n_');
var socket_ = require('./lib/socket_')

var app = express();
app.set('io', socket_.io);
var indexRouter = require('./routes/index')(socket_);
var usersRouter = require('./routes/users')(socket_);
var adminRouter = require('./routes/admin')(socket_);
var gameRouter = require('./routes/game')(socket_);

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(express.static(path.join(__dirname, 'public')));
app.use(logger('dev')); // 실험 진행 시 주석처리
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());
app.use(session({
  secret: 'gold_hamster',
  resave: false,
  saveUninitialized: true,
  store:new FileStore({retries: 2})
}))
app.use(requestIp.mw())
// app.use(favicon(path.join(__dirname, 'public/images', 'favicon.ico')))

app.use(i18nSetting.init);
app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/admin', adminRouter);
app.use('/game', gameRouter);

// 404 handler
app.use(function(req, res, next){
  res.redirect('/');
});

module.exports = app;