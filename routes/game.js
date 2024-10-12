var express = require('express');
const { check, validationResult } = require('express-validator');
var _ = require('lodash');

var db = require('../lib/mysql_')
var game_control = require('../lib/game_control');

module.exports = function(io) {
  var router = express.Router();

  router.get('/', function(req, res, next) {
    if (req.session.user_id === undefined || req.session.user_id ==='admin')
      res.redirect('/');
    else {
      var var_cookie_lang = req.cookies.lang
      if (var_cookie_lang === undefined) {
        res.cookie('lang', 'ko');
        var_cookie_lang = 'ko';
      }

      var var_game_input_status = req.cookies.game_input_status
      res.clearCookie('game_input_status');
      if (var_game_input_status === undefined)
        var_game_input_status = '';
      
      db.query('SELECT room, status, wait_other FROM users WHERE id=?', [req.session.user_id], function(err, user_info) { // get room id
        if (err) {
          console.log(err, req.session.user_id);
        }
        else {
          var user_room = user_info[0].room;
          var var_user_status = user_info[0].status;
          var var_is_wait = Number(user_info[0].wait_other);
          if (var_user_status === 1 || var_user_status === 2 || var_user_status === 0) { // prevent access
            res.redirect('/users');
          }
          else {
            db.query("SELECT id, start_time, round, input_one, input_two, total_one, total_two, budget, psum FROM game_record WHERE room_id=? AND (id=? OR id='admin') ORDER BY round", 
            [user_room, req.session.user_id], function(err4, all_game_record) {
              if (err4) {
                console.log(err4, req.session.user_id);
              }
              else {
                var user_game_record = [];
                var admin_start_time;
                var now_round = 0;
                for (var i = 0; i < all_game_record.length; ++i) {
                  if (all_game_record[i].id == 'admin') { // 관리자가 시작한 시간을 가져오고, round 를 가져옴
                    admin_start_time = all_game_record[i].start_time;
                    now_round += 1;
                  }
                  else {
                    user_game_record.push(all_game_record[i]);
                  }
                }
                var remain_time = 60 - Math.floor((Date.now() -  admin_start_time) / 1000); // here change 60 sec to another value

                var game_record_html = ``;
                var now_budget = 0;
                var budget_limit = 0;
                if (user_game_record.length > 0) { // 사용자 기록 테이블 생성
                  if (var_cookie_lang == 'ko')
                    var show_table_key = ['round', '소고기', '치킨', '소고기 총량', '치킨 총량', '예산', '변화량']
                  else if (var_cookie_lang == 'en')
                    var show_table_key = ['round', 'beef', 'chicken', 'total beef', 'total chicken', 'budget', 'difference']

                  game_record_html = `<thead class="thead-dark" >
                                            <tr>`;
                  
                  for (var i = 0; i < show_table_key.length; ++i) {
                    game_record_html +=     `<th>${show_table_key[i]}</th>`;
                  }
                  game_record_html +=       `</tr>
                                          </thead>
                                          <tbody>`;

                  for (var i = 0; i < user_game_record.length; ++i) {
                    if (i == 7) // ignore contribution record
                      continue;
                    game_record_html += `<tr>`;
                    for (var record_key in user_game_record[i]) {
                      if (record_key == 'id' || record_key == 'start_time') // dont show id and start_time
                        continue
                      if (i > 7 && record_key == 'round') // 커뮤니티 라운드 때문에 -1
                        game_record_html += `<td>${user_game_record[i][record_key]-1}</td>`;
                      else
                        game_record_html += `<td>${user_game_record[i][record_key]}</td>`;
                    }
                    game_record_html +=`</tr>`;
                  }
                  game_record_html += `</tbody>`;
                  now_budget = user_game_record[user_game_record.length-1].budget;
                  budget_limit = Math.max(now_budget, 0);
                }
                db.query("SELECT wait_other FROM users WHERE room=? AND id!=?", [user_room, req.session.user_id], function(err3, other_user_list) {
                  if (err3) {
                    console.log(err2, req.session.user_id);
                  }
                  else {
                    // 다른 사용자 상태 테이블 생성
                    var other_user_status_html = '';
                    for (var i = 0; i < other_user_list.length; ++i) {
                      var html_id = 'other_user_status_' + (i+1);
                      other_user_status_html += `<tr>
                                                  <td>${i+1}</td>
                                                  <td>Player${i+1}</td>`;
                      if (other_user_list[i].wait_other == 1)
                        other_user_status_html +=`<td><span class="badge badge-primary" id=${html_id}>${res.__('other_submit')}</span></td>`;
                      else
                        other_user_status_html +=`<td><span class="badge badge-danger" id="${html_id}">${res.__('other_wait')}</span></td>`;
                      other_user_status_html +=`
                                                </tr>`;
                    }

                    db.query('SELECT * FROM game_parameter WHERE room_id=?', [user_room], function(err, game_parameter) {
                      if (err) {
                        console.log(err, req.session.user_id);
                      }
                      else {
                        db.query('SELECT game_type FROM game_info WHERE room_id=?', [user_room], function(err, user_game_type) {
                          if (err) {
                            console.log(err, req.session.user_id);
                          }
                          else {
                            // 파라미터 리스트 html 생성
                            var game_parameters = game_parameter[0];
                            var beef_price = `${res.__('game_user_beefCost')}` + game_parameters.beef_cost_var;
                            if (game_parameters.beef_cost_b != 0)
                              beef_price += ` - ` + game_parameters.beef_cost_b + res.__('game_user_beefNum');
                            if (game_parameters.beef_cost_c != 0)
                              beef_price += ` - ` + game_parameters.beef_cost_c + res.__('game_user_chickenNum');
                            var chicekn_price = `${res.__('game_user_chickenCost')}` + game_parameters.chicken_cost_var;
                            if (game_parameters.chicken_cost_b != 0)
                              chicekn_price += ` - ` + game_parameters.chicken_cost_b + res.__('game_user_beefNum');
                            if (game_parameters.chicken_cost_c != 0)
                              chicekn_price += ` - ` + game_parameters.chicken_cost_c + res.__('game_user_chickenNum');
                            
                            var user_prev_round = now_round - 1;
                            db.query("SELECT budget FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [user_prev_round, user_room], function(err4, prev_game_record) {
                              if (err4) {
                                console.log(err4, req.session.user_id);
                              }
                              else {
                                // 최고, 최저 budget 생성
                                var largest_budget = -9999999;
                                var smallest_budget = 9999999;
                                for (var i = 0; i < prev_game_record.length; ++i) {
                                  largest_budget = (largest_budget > prev_game_record[i].budget) ? largest_budget : prev_game_record[i].budget;
                                  smallest_budget = (smallest_budget < prev_game_record[i].budget) ? smallest_budget : prev_game_record[i].budget;
                                }

                                res.render('game', { 
                                  cookie_lang: var_cookie_lang,
                                  user_status: var_user_status,
                                  now_user_id: req.session.user_id,
                                  game_input_status: var_game_input_status,
                                  is_wait: var_is_wait,
                                  now_round: now_round,
                                  user_room: user_room,
                                  remain_time: remain_time,
                                  other_user_status_html: other_user_status_html,
                                  game_record_html: game_record_html,
                                  budget: now_budget,
                                  budget_limit: budget_limit,
                                  smallest_budget: smallest_budget,
                                  largest_budget: largest_budget,
                                  game_parameters: game_parameters,
                                  beef_price: beef_price,
                                  chicekn_price: chicekn_price,
                                  game_type: user_game_type[0].game_type
                                });
                              }
                            });

                          }
                        });
                        
                      }
                    }); // end parameter query
                  }
                }); // end other user status query
              }
            }); // end game record query
              
          }
        }
      });
    }
  });

  router.get('/ko', function(req, res, next) {
    res.cookie('lang', 'ko');
    res.redirect('/game');
  });

  router.get('/en', function(req, res, next) {
    res.cookie('lang', 'en');
    res.redirect('/game');
  });

  router.get('/signout', function(req, res, next) {
    req.session.destroy(function(err) {
      if(err)
        console.log(err);

      res.redirect('/');
    })
  });

  // isDecimal -> allow float
  router.post('/submit_round', [
    check('input_one').isInt({ min: 0, max: 9999999}),
    check('input_two').isInt({ min: 0, max: 9999999})
  ],
  function(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.cookie('game_input_status', res.__('game_int_status'));
      res.redirect('/game');
    }
    else {
      var post = req.body;
      var input_one = post.input_one;
      var input_two = post.input_two;
      var round = Number(post.round);
      var room_number = post.room_number;
      var budget = Number(post.budget); // used for contribution
      budget = Math.max(budget, 0);
      
      db.query('SELECT * FROM game_parameter WHERE room_id=?', [room_number], function(err, game_parameter) {
        if (err) {
          console.log(err, req.session.user_id);
        }
        else {
          if (round != 8 &&  
            ((Number(game_parameter[0].beef_w) * Number(input_one) + Number(game_parameter[0].chicken_w) * Number(input_two)) * Number(game_parameter[0].init_w) > Number(game_parameter[0].loan))) { // normal input limit
            res.cookie('game_input_status', res.__('game_input_status'));
            res.redirect('/game');
          }
          else if (round == 8 && input_one > budget) { // contribution input limit
            res.cookie('game_input_status', res.__('game_input_contribution_status'));
            res.redirect('/game');
          }
          else {
            db.query('INSERT INTO game_record (round, id, room_id, start_time, input_one, input_two) VALUES (?, ?, ?, ?, ?, ?)', 
            [round, req.session.user_id, room_number, Date.now(), input_one, input_two], function(err, result) {
              if (err) { // duplicate
                console.log('user insert game error', err);
                res.redirect('/game');
              }
              else {
                db.query('UPDATE users SET wait_other=1 WHERE id=?', [req.session.user_id], function(err3, result) { // 다른 사용자에게 submit 알림
                  if (err3) {
                    console.log('during game, user insert error', err3);
                    res.redirect('/game');
                  }
                  else {
                    db.query('SELECT id FROM users WHERE room=?', [room_number], function(err2, user_info) {
                      if (err2) {
                        console.log('user get after insert game error', err2);
                        res.redirect('/game');
                      }
                      else {
                        for (var i = 0; i < user_info.length; ++i) {
                          if (user_info[i].id != req.session.user_id) {
                            io.message(io.user_2_socket_id[user_info[i].id], 'other_user_submit', '');
                          }
                        }
                        
                        // check all user submit
                        db.query("SELECT id FROM game_record WHERE round=? AND room_id=? AND id!='admin'", 
                        [round, room_number], function(err3, user_submit_list) {
                          if (err3) {
                            console.log('user get after insert game error', err3);
                            res.redirect('/game');
                          }
                          else {
                            if (user_info.length == user_submit_list.length) { // all user submit
                              game_control.cal_round(room_number, round, round + 1, user_submit_list, io);
                              res.redirect('/game');
                            }
                            else {
                              res.redirect('/game'); 
                            }
                          }
                        });
                      }
                    });
                  }
                });
              }
            });

          }
        }
      });

    }
  });

  return router;
}
