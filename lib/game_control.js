var db = require('./mysql_');
var _ = require('lodash');

var game_control = (function() {
    var room_timer = {};

    var make_room_timer = function(room_number, round, io) {
        room_timer[room_number] = setTimeout( function() { room_time_out(room_number, round, io); }, 62 * 1000) ; // 60 + 2sec, as delay
    }

    var stop_room_timer = function(room_number) {
        clearTimeout(room_timer[room_number]);
    }

    // 제한 시간 종료 후 호출
    function room_time_out(room_number, round, io) {
        var user_round = Number(round) - 1; // user behind admin
        var admin_round = round;
        db.query('SELECT id, wait_other FROM users WHERE room=?', [room_number], function(err, user_submit_list) {
            if (err)
                console.log('room time out error', err);
            else {
                var insert_cnt = 0;
                for (var i = 0; i < user_submit_list.length; ++i) {
                    if (user_submit_list[i].wait_other == 0) // user didnt submit
                        insert_cnt += 1
                }
                var finished = _.after(insert_cnt, cal_round);

                for (var i = 0; i < user_submit_list.length; ++i) {
                    if (user_submit_list[i].wait_other == 0) { // user didnt submit
                        (function(now_sql, now_param){
                            db.query(now_sql, now_param, function(err3, result) {
                                if (err3) {
                                    if (err3.code === 'ER_DUP_ENTRY') { // duplicate
                                        finished(room_number, user_round, admin_round, user_submit_list, io);
                                        console.log('room insert same time, ignore 0 insert', room_number);
                                    }
                                    else
                                        console.log('during game, user insert error', err3);
                                }
                                else
                                    finished(room_number, user_round, admin_round, user_submit_list, io);
                            });
                        })
                        ('INSERT INTO game_record (round, id, room_id, start_time, input_one, input_two) VALUES(?, ?, ?, ?, 0, 0)', 
                        [user_round, user_submit_list[i].id, room_number, Date.now()]);
                    }
                }
            }
        });
    }

    var cal_round = function(room_number, user_round, admin_round, user_submit_list, io) {
        stop_room_timer(room_number); // 타이머 삭제
        io.message(io.user_2_socket_id['admin'], 'change_room_round', { // 관리자에게 라운드 바뀐 것 알림
          round:admin_round,
          room_number:room_number
        });
        if (user_round == 9) // skip contribution round
          var user_prev_round = user_round - 2;
        else
          var user_prev_round = user_round - 1;
        // get prev roudn budget
        db.query("SELECT id, budget FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [user_prev_round, room_number], function(err4, prev_game_record) {
          if (err4) {
            console.log(err4, req.session.user_id);
          }
          else {
            // get cur round input
            db.query("SELECT id, input_one, input_two FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [user_round, room_number], function(err3, record_info) {
              if (err3) {
                console.log('cal error', err3);
              }
              else {
                // get game parameter
                db.query('SELECT * FROM game_parameter WHERE room_id=?', [room_number], function(err, parameters) {
                  if (err) {
                    console.log('cal error', err);
                  }
                  else {
                    if (user_round != 8) { // normal game
                      var total_one = 0;
                      var total_two = 0;
                      for (var i = 0; i < record_info.length; ++i) {
                        total_one += record_info[i].input_one;
                        total_two += record_info[i].input_two;
                      }
                      var price_one = Math.max(0, parameters[0].beef_cost_var - parameters[0].beef_cost_b * total_one - parameters[0].beef_cost_c * total_two);
                      var price_two = Math.max(0, parameters[0].chicken_cost_var - parameters[0].chicken_cost_b * total_one - parameters[0].chicken_cost_c * total_two);
                      
                      var finished = _.after(record_info.length, add_admin);
                      for (var i = 0; i < record_info.length; ++i) {
                        var cur_round_profit = price_one * record_info[i].input_one + price_two * record_info[i].input_two 
                                              - parameters[0].init_w * (parameters[0].beef_w * record_info[i].input_one + parameters[0].chicken_w * record_info[i].input_two);
                        if (user_round == 1) { // no prev data
                          var cur_budget = parameters[0].init_budget + cur_round_profit;
                          var cur_psum =  cur_budget - parameters[0].init_budget; // diff - name conflict
                        }
                        else {
                          var cur_budget = prev_game_record[i].budget + cur_round_profit;
                          var cur_psum =  cur_budget - prev_game_record[i].budget;
                        }   
                        var cur_id = record_info[i].id;
                        (function(now_param){
                            db.query('UPDATE game_record SET total_one=?, total_two=?, price_one=?, price_two=?, profit=?, budget=?, psum=? WHERE id=? AND round=? AND room_id=?', 
                            now_param, 
                            function(err7, result) {
                                if (err7) {
                                    console.log('update parame', err7);
                                }
                                else {
                                    finished(admin_round, room_number, user_submit_list, io);
                                }
                            });
                        })([total_one, total_two, price_one, price_two, cur_round_profit, cur_budget, cur_psum, cur_id, user_round, room_number]);
                      }
                    } // end normal
                    else { // energy contribution
                      db.query('SELECT game_type FROM game_info WHERE room_id=?', [room_number], function(err7, user_game_type) {
                        if (err7) {
                          console.log('select contribution game type', err7);
                        } 
                        else {
                          var total_one = 0;
                          for (var i = 0; i < record_info.length; ++i) {
                            total_one += record_info[i].input_one;
                          }
                          var finished = _.after(record_info.length, add_admin);
                          if (user_game_type[0].game_type == 1) { // TR1 --> set new W
                            var new_w = Math.max(1, parameters[0].init_w - parameters[0].contri_var * total_one);
                            db.query('UPDATE game_parameter SET init_w=? WHERE room_id=?', [new_w, room_number], function(err7, result) {
                                if (err7)
                                    console.log('update contribution', err7);
                                else {
                                  // subtract contribution
                                  for (var i = 0; i < record_info.length; ++i) {
                                    for (var j = 0; j < record_info.length; ++j) {
                                      if (record_info[i].id == prev_game_record[j].id) {
                                        (function(now_param){
                                          db.query('UPDATE game_record SET budget=? WHERE id=? AND round=? AND room_id=?', 
                                          now_param, 
                                          function(err7, result) {
                                              if (err7) {
                                                  console.log('update parame', err7);
                                              }
                                              else {
                                                  finished(admin_round, room_number, user_submit_list, io);
                                              }
                                          });
                                        })([prev_game_record[j].budget - record_info[i].input_one, record_info[i].id, user_prev_round, room_number]);
                                      }
                                    }
                                  }
                                  //
                                }
                            });
                          }
                          else { // TR2 --> no new W, subsidy
                            var subsidy = Math.min(parameters[0].contri_var, parameters[0].change_var + parameters[0].change_weight * total_one);
                            // subtract contribution
                            for (var i = 0; i < record_info.length; ++i) {
                              for (var j = 0; j < record_info.length; ++j) {
                                if (record_info[i].id == prev_game_record[j].id) {
                                  (function(now_param){
                                    db.query('UPDATE game_record SET budget=? WHERE id=? AND round=? AND room_id=?', 
                                    now_param, 
                                    function(err7, result) {
                                        if (err7) {
                                            console.log('update parame', err7);
                                        }
                                        else {
                                            finished(admin_round, room_number, user_submit_list, io);
                                        }
                                    });
                                  })([prev_game_record[j].budget - record_info[i].input_one + subsidy, record_info[i].id, user_prev_round, room_number]);
                                }
                              }
                            }
                          }
                          
                        }
                      }); // end contribution
                    } // select game type else
                  } // select game parameter else
                }); // end select game parameter
              }
            }); // end one round
          } // end prev budget
        });
      }

      function add_admin(admin_round, room_number, user_submit_list, io) {
          db.query("INSERT INTO game_record (round, id, room_id, start_time) VALUES(?, 'admin', ?, ?)", [admin_round, room_number, Date.now()], function(err2, result) {
              if (err2) {
                  if (err2.code === 'ER_DUP_ENTRY')
                      console.log('ignore duplicate', admin_round);
                  else
                      console.log('insert admin game error', err2);
              }
              else {
                  for (var i = 0; i < user_submit_list.length; ++i) {
                      (function(now_id){
                      db.query('UPDATE users SET wait_other=0 WHERE id=?', [now_id], function(err3, result) {
                        if (err3)
                          console.log('update user wait 0', now_id);
                        else {
                          io.message(io.user_2_socket_id[now_id], 'reload_as_status_change', '');
                        }
                      });
                      })(user_submit_list[i].id);
                  }
  
                  if (admin_round <= 15) // 7 + 1 (contribution) + 7 is end
                      make_room_timer(room_number, admin_round + 1, io);
                  else if (admin_round > 15) { // game end 
                      db.query('UPDATE users SET status=5 WHERE room=?', [room_number], function(err2, result) {
                          if (err2) {
                              console.log('end game', err2);
                          }
                          else {
                              for (var i = 0; i < user_submit_list.length; ++i) {
                                  var now_id = user_submit_list[i].id;
                                  io.message(io.user_2_socket_id['admin'], 'change_user_status', {
                                  user_id:now_id,
                                  status:'5'
                                  });
                              }
                              io.message(io.user_2_socket_id['admin'], 'change_room_round', {
                                  round:'end',
                                  room_number:room_number
                              });
                              db.query('UPDATE game_info SET room_status=3 WHERE room_id=?', [room_number], function(err3, result) {
                                  if (err3)
                                      console.log('game end err', err3);
                              });
                          }
                      });
                  }
              }
          });
        }

    // public attribute, method
    return {
        make_room_timer: make_room_timer,
        stop_room_timer: stop_room_timer,
        cal_round: cal_round
    };

}());

module.exports = game_control;