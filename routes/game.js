var express = require('express');
const { check, validationResult } = require('express-validator');
var _ = require('lodash');
var db = require('../lib/mysql_');
var game_control = require('../lib/game_control');

module.exports = function(io) {
  var router = express.Router();
  
router.get('/', function(req, res, next) {
  if (!req.session.user_id || req.session.user_id === 'admin') {
    return res.redirect('/');
  } else {
    var var_cookie_lang = req.cookies.lang || 'ko';
    res.cookie('lang', var_cookie_lang);

    var var_game_input_status = req.cookies.game_input_status || '';
    res.clearCookie('game_input_status');

    db.query('SELECT room, status, wait_other FROM users WHERE id=?', [req.session.user_id], function(err, user_info) {
      if (err) {
        console.error(err, req.session.user_id);
        return next(err);
      } else {
        var user_room = user_info[0].room;
        var var_user_status = user_info[0].status;
        var var_is_wait = Number(user_info[0].wait_other);

        if (var_user_status === 1 || var_user_status === 2 || var_user_status === 0) {
          return res.redirect('/users');
        } else {
          db.query("SELECT id, start_time, round, input_one, total_one, price_one, budget, profit FROM game_record WHERE room_id=? AND (id=? OR id='admin') ORDER BY round", [user_room, req.session.user_id], function(err4, all_game_record) {
            if (err4) {
              console.error(err4, req.session.user_id);
              return next(err4);
            } else {
              var user_game_record = [];
              var admin_start_time;
              var now_round = 0;

              all_game_record.forEach(record => {
                if (record.id == 'admin') {
                  admin_start_time = record.start_time;
                  now_round += 1;
                } else {
                  user_game_record.push(record);
                }
              });

              var remain_time = 120 - Math.floor((Date.now() - admin_start_time) / 1000);

              var game_record_html = '';
              var now_budget = 0;
              var community_input = 0;
              var budget_limit = 0;

              if (user_game_record.length > 0) {
                var previous_game_record = user_game_record.filter(record => record.round < now_round);
            
                // 라운드가 8 이상일 경우 1~7 라운드를 제외
                if (now_round >= 8) {
                    previous_game_record = previous_game_record.filter(record => record.round > 7);
                }
            
                // 라운드 6, 7, 13, 14, 20, 21, 27, 28 제외
                previous_game_record = previous_game_record.filter(record => ![6, 7, 13, 14, 20, 21, 27, 28].includes(record.round));
            
                if (previous_game_record.length > 0) {
                    var show_table_key = var_cookie_lang === 'ko' ? ['라운드', '전기 구입량', '그룹 총 구입량', '제품 가격', '예산', '이윤'] : ['Round', 'My Electricity', 'Group Electricity', 'Price', 'Budget', 'Profit'];
            
                    game_record_html = `<div class="table-responsive">
                                            <table class="table table-bordered table-sm">
                                                <thead class="thead-dark">
                                                    <tr>`;
            
                    show_table_key.forEach(key => {
                        game_record_html += `<th style="text-align: center;">${key}</th>`;
                    });
            
                    game_record_html += `</tr></thead><tbody>`;
            
                    previous_game_record.forEach((record) => {
                        game_record_html += `<tr>`;
            
                        // 'round' key에서 직접 값을 가져옴
                        var round = record.round;
            
                        // 라운드 값을 올바르게 표시
                        if (round > 13 && round < 20) {
                            round -= 9;
                        } else if (round > 20 && round < 27) {
                            round -= 11;
                        } else if (round > 6 && round <= 13) {
                            round -= 7;
                        } else if (round > 27) {
                            round -= 13;
                        }
            
                        game_record_html += `<td style="text-align: center;">${round}</td>`;
            
                        // 다른 값들 표시
                        for (var record_key in record) {
                            if (['id', 'start_time'].includes(record_key)) continue;
                            if (record_key !== 'round') {
                                game_record_html += `<td style="text-align: center;">${record[record_key]}</td>`;
                            }
                        }
                        game_record_html += `</tr>`;
                    });
            
                    game_record_html += `</tbody></table></div>`;
                    now_budget = previous_game_record[previous_game_record.length - 1].budget;
                    community_input = previous_game_record[previous_game_record.length - 1].input_one;
                    budget_limit = Math.max(now_budget, 0);
                }
            }

              db.query('SELECT province_id FROM game_info WHERE room_id=?', [user_room], function(err, rows) {
                if (err) {
                  console.error(err, req.session.user_id);
                  return next(err);
                } else {
                  var province_id = rows[0].province_id;

                  // province_id가 같은 그룹의 room_submit 상태 가져오기
                  db.query('SELECT room_submit, room_id FROM game_info WHERE province_id=? AND room_id != ?', [province_id, user_room], function(err, room_submit_list) {
                    if (err) {
                      console.error(err, req.session.user_id);
                      return next(err);
                    } else {
                      var room_submit_html = room_submit_list.map((room, i) => {
                        var badge_class = room.room_submit === 1 ? 'badge-success' : 'badge-danger';
                        return `<span class="badge ${badge_class}">Group ${i + 1}</span>`;
                      }).join(' ');

                      var community_round;
                      
                      // 커뮤니티 라운드 계산

                      if (now_round > 13 && now_round < 20) {
                        community_round = 13;
                    } else if (now_round > 20 && now_round < 27) {
                        community_round = 20;
                    } else if (now_round > 27) {
                        community_round = 27;
                    } else if (now_round <= 7) {  // 라운드 7 이하의 라운드 처리
                        community_round = 6;  // 초기 라운드로 설정
                    }
                      // 총 에너지 계산
                      db.query('SELECT * FROM total_energy_record WHERE province_id = ? AND round = ?', [province_id, community_round], function(err_total, energy_submit_list) {
                        if (err_total) {
                          console.error(err_total);
                          return next(err_total);
                        } else { 
                          var total_energy_list = energy_submit_list.map(energy => energy.total_energy);
                          var total_energy_div_4_list = energy_submit_list.map(energy => energy.total_energy /4);
                          var total_energy_div_140_list = energy_submit_list.map(energy => Math.floor(energy.total_energy / 140));


                          db.query("SELECT wait_other FROM users WHERE room=? AND id!=?", [user_room, req.session.user_id], function(err3, other_user_list) {
                            if (err3) {
                              console.error(err3, req.session.user_id);
                              return next(err3);
                            } else {
                              var other_user_status_html = other_user_list.map((user, i) => {
                                var html_id = 'other_user_status_' + (i + 1);
                                var status_badge = user.wait_other == 1 ? `<span class="badge badge-primary" id=${html_id}>${res.__('other_submit')}</span>` : `<span class="badge badge-danger" id="${html_id}">${res.__('other_wait')}</span>`;
                                return `<tr><td>${i + 1}</td><td>Player${i + 1}</td><td>${status_badge}</td></tr>`;
                              }).join('');

                              db.query('SELECT * FROM game_parameter WHERE room_id=?', [user_room], function(err, game_parameter) {
                                if (err) {
                                  console.error(err, req.session.user_id);
                                  return next(err);
                                } else {
                                  db.query('SELECT game_type FROM game_info WHERE room_id=?', [user_room], function(err, user_game_type) {
                                    if (err) {
                                      console.error(err, req.session.user_id);
                                      return next(err);
                                    } else {
                                      var game_parameters = game_parameter[0];
                                      var production_price = `${res.__('game_user_Cost')}${game_parameters.price_var} - ${res.__('game_user_Num')}`;
                                      var user_prev_round = now_round - 1;

                                      db.query("SELECT budget, input_one FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [user_prev_round, user_room], function(err4, prev_game_record) {
                                        if (err4) {
                                          console.error(err4, req.session.user_id);
                                          return next(err4);
                                        } else {
                                          var budgets = prev_game_record.map(record => record.budget);
                                          var largest_budget = Math.max(...budgets);
                                          var smallest_budget = Math.min(...budgets);
                                          var total_one = budgets.reduce((sum, budget) => sum + budget, 0);
                                          var mean_value = total_one / budgets.length;


                                          db.query("SELECT input_one, room_id FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [community_round, user_room], function(err4, community_round_record) {
                                            if (err4) {
                                              console.error(err4, req.session.user_id);
                                              return next(err4);
                                            } else {
                                              var inputs = community_round_record.map(record => record.input_one);
                                              var total_contribution = community_round_record.reduce((sum, record) => sum + record.input_one, 0);
                                              var mean_contribution = total_contribution / community_round_record.length;
                                              var usable_electrocity = Math.floor(total_contribution / 140);

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
                                                mean_value_budget: mean_value,
                                                game_parameters: game_parameters,
                                                production_price: production_price,
                                                game_type: user_game_type[0].game_type,
                                                isdisaster_occured: game_parameters.isdisasteroccured,
                                                total_contribution: total_contribution,
                                                mean_contribution: mean_contribution,
                                                community_input: community_input,
                                                usable_electrocity: usable_electrocity,
                                                total_energy_list: total_energy_list, 
                                                room_submit_html: room_submit_html,
                                                budgets: budgets,
                                                inputs: inputs,
                                                total_energy_div_4_list : total_energy_div_4_list,
                                                total_energy_div_140_list : total_energy_div_140_list
                                              });
                                            }
                                          });
                                        }
                                      });
                                    }
                                  });
                                }
                              });
                            }
                          });
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
      if (err) {
        console.error(err);
      }
      res.redirect('/');
    });
  });

  router.post('/submit_round', [
    check('input_one').isInt({ min: 0, max: 9999999 }),
    check('input_two').isInt({ min: 0, max: 9999999 })
], function(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.cookie('game_input_status', res.__('game_int_status'));
        return res.redirect('/game');
    } else {
        var post = req.body;
        var input_one = post.input_one;
        var input_two = post.input_two;
        var round = Number(post.round);
        var room_number = post.room_number;

        db.query('SELECT * FROM game_parameter WHERE room_id=?', [room_number], function(err, game_parameter) {
            if (err) {
                console.error(err, req.session.user_id);
                return next(err);
            } else {
                var game_params = game_parameter[0];
                var init_budget = Number(game_params.init_budget);
                var init_w = Number(game_params.init_w);
                var total_energy = Number(game_params.total_energy);
                var is_disaster_occurred = game_params.isdisasteroccured;
                var budget = Math.max(Number(post.budget), 0); // 사용된 기여도

                // 유효성 검사
                if ((round === 1 || round === 8) && (input_one > 50)) {
                    res.cookie('game_input_status', res.__('game_input_status'));
                    return res.redirect('/game');
                } else if ((round === 7 || round === 14 || round === 21 || round == 28) && input_one > 7) {
                    res.cookie('game_input_status', res.__('predicted_input_disaster'));
                    return res.redirect('/game');
                } else if ((round === 6 || round === 13 || round === 20 || round == 27) && input_one > budget) {
                    res.cookie('game_input_status', res.__('game_input_contribution_status'));
                    return res.redirect('/game');
                } else if ((round === 6 || round === 13 || round === 20 || round == 27) && input_two > 10) {
                    res.cookie('game_input_status', res.__('predicted_input_disaster'));
                    return res.redirect('/game');
                } else if (![1, 6, 7, 13, 14, 20, 21, 27, 28].includes(round) && is_disaster_occurred === 1 && round > 14 && (input_one > Math.floor(total_energy / 4))) {
                    res.cookie('game_input_status', res.__('game_disaster_status'));
                    return res.redirect('/game');
                } else if (![1, 6, 7, 13, 14, 20, 21, 27, 28].includes(round) && is_disaster_occurred === 0 && (input_one > 50)) {
                    res.cookie('game_input_status', res.__('game_input_status'));
                    return res.redirect('/game');
                } else {
                    // 중복 확인
                    db.query('SELECT * FROM game_record WHERE round=? AND id=? AND room_id=?', 
                        [round, req.session.user_id, room_number], function(err, result) {
                        if (err) {
                            console.error('check duplicate error', err);
                            return res.redirect('/game');
                        } else if (result.length > 0) {
                            res.cookie('game_input_status', res.__('duplicate_entry'));
                            return res.redirect('/game');
                        } else {
                            // 게임 기록 삽입
                            db.query('INSERT INTO game_record (round, id, room_id, start_time, input_one, input_two) VALUES (?, ?, ?, ?, ?, ?)', 
                                [round, req.session.user_id, room_number, Date.now(), input_one, input_two], function(err, result) {
                                if (err) {
                                    console.error('user insert game error', err);
                                    return res.redirect('/game');
                                } else {
                                    db.query('UPDATE users SET wait_other=1 WHERE id=?', [req.session.user_id], function(err3) {
                                        if (err3) {
                                            console.error('during game, user insert error', err3);
                                            return res.redirect('/game');
                                        } else {
                                            db.query('SELECT id FROM users WHERE room=?', [room_number], function(err2, user_info) {
                                                if (err2) {
                                                    console.error('user get after insert game error', err2);
                                                    return res.redirect('/game');
                                                } else {
                                                    user_info.forEach(user => {
                                                        if (user.id != req.session.user_id) {
                                                            io.message(io.user_2_socket_id[user.id], 'other_user_submit', '');
                                                        }
                                                    });
                                                    db.query("SELECT id FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [round, room_number], function(err3, user_submit_list) {
                                                        if (err3) {
                                                            console.error('user get after insert game error', err3);
                                                            return res.redirect('/game');
                                                        } else {
                                                            if (user_info.length === user_submit_list.length) { 
                                                                if (round == 6 || round == 13 || round == 20 || round == 27) {
                                                                    db.query('SELECT province_id FROM game_info WHERE room_id=?', [room_number], function(err4, game_info) {
                                                                        if (err4) {
                                                                            console.error('Error getting province_id:', err4);
                                                                            return res.redirect('/game');
                                                                        } else {
                                                                            var province_id = game_info[0].province_id;
                                                                            db.query('UPDATE game_info SET room_submit=1 WHERE room_id=?', [room_number], function(err5) {
                                                                                if (err5) {
                                                                                    console.error('Error updating room_submit:', err5);
                                                                                    return res.redirect('/game');
                                                                                } else {
                                                                                    // 동일한 province_id를 가진 모든 그룹이 완료되었는지 확인
                                                                                    db.query('SELECT room_id FROM game_info WHERE province_id = ?', [province_id], function(error2, province_rooms) {
                                                                                        if (error2) {
                                                                                            console.error('Error in Choosing group with same province_id');
                                                                                            return res.redirect('/game');
                                                                                        } else {
                                                                                            province_rooms.forEach(room => {
                                                                                                db.query('SELECT id FROM users WHERE room=?', [room.room_id], function(err3, province_user_lists) {
                                                                                                    if (err3) {
                                                                                                        console.error('Error updating wait_other for users in room:', room.room_id, err3);
                                                                                                    } else {
                                                                                                        province_user_lists.forEach(user => {
                                                                                                            io.message(io.user_2_socket_id[user.id], 'reload_as_status_change', '');
                                                                                                        });
                                                                                                    }
                                                                                                });
                                                                                            });

                                                                                            db.query('SELECT COUNT(*) AS incomplete FROM game_info WHERE province_id=? AND room_submit = 0', [province_id], function(err6, result6) {
                                                                                                if (err6) {
                                                                                                    console.error('Error checking group completion:', err6);
                                                                                                    return res.redirect('/game');
                                                                                                } else {
                                                                                                    if (result6[0].incomplete === 0) {
                                                                                                        // 동일한 province에 있는 모든 방의 room_id 가져오기
                                                                                                        db.query('SELECT room_id FROM game_info WHERE province_id=?', [province_id], function(err7, province_rooms) {
                                                                                                            if (err7) {
                                                                                                                console.error('Error getting province rooms:', err7);
                                                                                                                return res.redirect('/game');
                                                                                                            } else {
                                                                                                                // province의 각 방에 대해 cal_round 실행
                                                                                                                province_rooms.forEach(room => {
                                                                                                                    game_control.cal_round(room.room_id, round, round + 1, user_submit_list, io);
                                                                                                                    io.message(io.user_2_socket_id[user_submit_list.id], 'reload_as_status_change', '');
                                                                                                                });

                                                                                                                // province 내 모든 방의 room_submit을 리셋
                                                                                                                db.query('UPDATE game_info SET room_submit=0 WHERE province_id=?', [province_id], function(err8) {
                                                                                                                    if (err8) {
                                                                                                                        console.error('Error resetting room_submit:', err8);
                                                                                                                        return res.redirect('/game');
                                                                                                                    } else {
                                                                                                                        return res.redirect('/game');
                                                                                                                    }
                                                                                                                });
                                                                                                            }
                                                                                                        });
                                                                                                    } else {
                                                                                                        // 모든 그룹이 완료되지 않았으므로 리다이렉트만 수행
                                                                                                        return res.redirect('/game');
                                                                                                    }
                                                                                                }
                                                                                            });
                                                                                        }
                                                                                    });
                                                                                }
                                                                            });
                                                                        }
                                                                    });
                                                                } else {
                                                                    // 지정 라운드가 아닌 경우 바로 진행
                                                                    game_control.cal_round(room_number, round, round + 1, user_submit_list, io);
                                                                    return res.redirect('/game');
                                                                }
                                                            } else {
                                                                return res.redirect('/game');
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
                    });
                }
            }
        });
    }
 });

return router;
};
