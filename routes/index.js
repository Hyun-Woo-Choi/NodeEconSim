var express = require('express');
var bcrypt = require('bcrypt');

var db = require('../lib/mysql_')

module.exports = function(io) {
  var router = express.Router();

  router.get('/', function(req, res, next) {
    if (req.session.user_id) { // already sign in
      if (req.session.user_id === 'admin')
        res.redirect('/admin');
      else
        res.redirect('/users');
    }
    else {
      var var_cookie_lang = req.cookies.lang;
      if (var_cookie_lang === undefined) {
        res.cookie('lang', 'en');
        var_cookie_lang = 'en';
      }
      
      // 로그인 실패 여부
      var var_login_status = req.cookies.login_status;
      res.clearCookie('login_status');
      if (var_login_status === undefined)
        var_login_status = '';
        
      res.render('index', { 
        cookie_lang: var_cookie_lang,
        login_status: var_login_status
      });
    }
  });

  router.get('/ko', function(req, res, next) {
    res.cookie('lang', 'ko');
    res.redirect('/');
  });

  router.get('/en', function(req, res, next) {
    res.cookie('lang', 'en');
    res.redirect('/');
  });

  // 로그인
  router.post('/login_process', function(req, res, next) {
    var input_id = req.body.input_id;
    var input_password = req.body.input_password;
    db.query('SELECT * FROM users WHERE id=?', [input_id], function(err, info) {
      if (err) {
        console.log(err, input_id);
        res.redirect('/');
      }
      else {
        if (info.length > 0) {
          bcrypt.compare(input_password, info[0].password, function(err2, result) {
            if (err2) { // 에러
              console.log(err2, input_id);
              res.redirect('/');
            }
            else {
              if (result) {
                if (input_id in io.user_2_socket_id) { // 중복 로그인 방지
                  io.message(io.user_2_socket_id[input_id], 'duplicate_login', req.clientIp);
                  res.cookie('login_status', res.__('duplicate_login'));
                  res.redirect('/');
                }
                else { // 성공
                  req.session.user_id = input_id;
                  if (input_id === 'admin')
                    res.redirect('/admin');
                  else
                    res.redirect('/users');
                }
              }
              else { // 아이디 혹은 비밀번호 불일치
                res.cookie('login_status', res.__('login_status'));
                res.redirect('/');
              }
            }
          });
        }
        else {
          res.cookie('login_status', res.__('login_status'));
          res.redirect('/');
        }
      }
    });
  });

  // 중복 로그인 - session 삭제
  router.get('/session_destroy_as_duplicate', function(req, res, next) {
    req.session.destroy(function(err) {
      if(err)
        console.log(err);

      res.redirect('/');
    })
  });

  return router;
}