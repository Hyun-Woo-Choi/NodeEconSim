var express = require('express');
var bcrypt = require('bcrypt');
const fastcsv = require("fast-csv");
const fs = require("fs");

var db = require('../lib/mysql_');
var game_control = require('../lib/game_control');

module.exports = function(io) {
  var router = express.Router();

  router.get('/', function(req, res, next) {
    if (req.session.user_id === undefined || req.session.user_id !=='admin')
      res.redirect('/');
    else {
      var var_cookie_lang = req.cookies.lang;
      if (var_cookie_lang === undefined) {
        res.cookie('lang', 'ko');
        var_cookie_lang = 'ko';
      }
      
      var var_admin_status = req.cookies.admin_status;
      res.clearCookie('admin_status');
      if (var_admin_status === undefined)
        var_admin_status = '';

      res.render('admin', { 
        cookie_lang: var_cookie_lang,
        admin_status: var_admin_status,
        start_text: res.__('start'),
        restart_text: res.__('restart')
      });
    }
  });

  router.get('/ko', function(req, res, next) { // 한국어
    res.cookie('lang', 'ko');
    res.redirect('/admin');
  });

  router.get('/en', function(req, res, next) { // 영어
    res.cookie('lang', 'en');
    res.redirect('/admin');
  });

  router.get('/signout', function(req, res, next) { //로그아웃
    req.session.destroy(function(err) {
      if(err)
        console.log(err);

      res.redirect('/');
    })
  });

  router.post('/make_one_id', function(req, res, next) { // id 생성
    var input_id = req.body.input_id;
    var input_password = req.body.input_password;
    db.query('SELECT id FROM users WHERE id=?', [input_id], function(err, info) {
      if (err) {
        console.log(err, input_id);
        res.redirect('/admin');
      }
      else {
        if (info.length > 0) { // id duplicate
          res.cookie('admin_status', res.__('make_id_fail'));
          res.redirect('/admin');
        }
        else {
          bcrypt.hash(input_password, 10, function(err, hash) {
            db.query('INSERT INTO users (id, password) VALUES(?, ?)', [input_id, hash], function(err2, result) {
              if (err2) {
                console.log(err2, input_id);
                res.redirect('/admin');
              }
              else {
                res.cookie('admin_status', res.__('make_id_success'));
                res.redirect('/admin');
              }
            });
          });
        }
      }
    });
  });

  // 파라미터 불러와서 뿌려줌
  router.post('/patch_parameter', function(req, res, next) {
    var type_val = req.body.type_val;

    if (type_val === '1' || type_val === '2' || type_val === '3') {
      db.query('SELECT * FROM disaster_parameter', function(err, whole_parameter) {
        if (err) {
          console.log('admin', err);
          res.redirect('/admin');
        }
        else {
          var return_html = '<form method="post" action="/admin/set_parameter">';
          var parameters = [];
          for (var key in whole_parameter[0]) {
            parameters.push(whole_parameter[0][key]);
          }
          var input_ids = ["init_w", "adjusted_w", "price_var", "init_budget", "disaster_probability", "disaster_number"]

          for (var i = 0; i < input_ids.length; ++i) {
            return_html += `<div class="form-group row"> <label for=${input_ids[i]} class="col-4 col-form-label">${input_ids[i]}</label>
              <div class="col-8">
                <input type="text" class="form-control" id=${input_ids[i]} name=${input_ids[i]} value=${parameters[i]} required="true"> </div>
            </div>`
          }
          return_html += `<input type="hidden" id="type_val" name="type_val" value=${type_val}>`
          return_html += '<button type="submit" class="btn btn-primary" style="float: right;">Submit</button>';
          return_html += '</form>';
          res.send(return_html);
        }
      });
    }})

  // 파라미터 조정
  router.post('/set_parameter', function(req, res, next) {
    var post = req.body;
    var type_val = post.type_val;

    if (type_val === '1' || type_val === '2' || type_val === '3') {
      var sql = 'UPDATE disaster_parameter SET init_w=?, adjusted_w=?, price_var=?, init_budget=?, disaster_probability=?, disaster_number=?';
      var params = [post.init_w, post.adjusted_w, post.price_var, post.init_budget, post.disaster_probability, post.disaster_number];
      db.query(sql, params, function(err, result) {
        if (err) {
          res.cookie('admin_status', res.__('set_parameter_fail'));
          res.redirect('/admin');
        }
        else {
          res.cookie('admin_status', res.__('set_parameter_success'));
          res.redirect('/admin');
        }
      });
    }});

  // 방 생성
  router.post('/make_one_room', function(req, res, next) {
    var type_val = req.body.type_val;

    db.query('INSERT INTO game_info (game_type) VALUES(?)', [type_val], function(err, result) {
      if (err) {
        console.log('admin', err);
      }
      else {
        db.query('SELECT room_id FROM game_info', function(err2, game_list) {
          if (err2) {
            console.log('admin', err2);
          }
          else {
            var sql_parameter;
            var sql_parameter = 'SELECT * FROM disaster_parameter';
            var next_room_id = game_list[game_list.length - 1].room_id;
            db.query(sql_parameter, function(err5, parameters) {
              if (err5) {
                console.log('admin', err5);
              }
              else {
                var game_parameter_sql;
                var game_parameter_parameter;

                  game_parameter_sql = 'INSERT INTO game_parameter (room_id, init_w, adjusted_w, price_var, init_budget, disaster_probability, isdisasteroccured,\
                    first_disaster, second_disaster, total_energy, disaster_number) \
                  VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
                  game_parameter_parameter = [next_room_id, parameters[0].init_w, parameters[0].adjusted_w, parameters[0].price_var, parameters[0].init_budget, 
                  parameters[0].disaster_probability, parameters[0].isdisasteroccured, parameters[0].first_disaster, parameters[0].second_disaster, parameters[0].total_energy, parameters[0].disaster_number];
                
                db.query(game_parameter_sql, game_parameter_parameter, function(err6, result) {
                  if (err6) {
                    console.log('admin', err6);
                  }
                  else {
                    var round_room_id = "round" + next_room_id;
                    var wrap_room_id = "wrap_room" + next_room_id;
                    var start_room_id = 'start' + next_room_id;
                    var stop_room_id = 'stop' + next_room_id;
                    var return_html = `
                    <div class="col-md-3 mb-3" id=${wrap_room_id}>
                      <div class="card text-center">
                        <div class="card-header" > Room: ${next_room_id}, Type: ${type_val}, round: <span id=${round_room_id}>1</span> <button type="button" class="delete_room_class close ml-auto" data-id=${next_room_id}> <span>x</span> </button> </div>
                        <div class="card-body" id=${next_room_id}>
                        </div>
                        <div class="card-footer text-muted"> 
                          <button class="start_room_class btn btn-primary text-white" data-id=${next_room_id} id=${start_room_id}>${res.__('start')}</button>
                          <button class="stop_room_class btn btn-primary text-white" data-id=${next_room_id} id=${stop_room_id} disabled>${res.__('stop')}</button>
                        </div>
                      </div>
                    </div>`
                    ;
                    res.send(return_html);
                  }
                });
              }
            });
          }
        });
      }
    });
  });

  // 3개의 그룹마다 동일한 Province_id 형성
  router.post('/assign_province', function(req, res, next) {
    db.query('SELECT room_id FROM game_info ORDER BY room_id ASC', function(err, results) {
      if (err) {
        console.log('admin province error', err);
        return res.status(500).send('Error retrieving game rooms');
      }
  
      const game_list = results;
      if (game_list.length === 0) {
        return res.status(404).send('No game rooms found');
      }
  
      let province_id = 1;
      const province_n = 3;
  
      const updateProvince = function(index) {
        if (index >= game_list.length) {
          return res.send('Provinces assigned successfully');
        }
  
        const room_id = game_list[index].room_id;
        db.query('UPDATE game_info SET province_id = ? WHERE room_id = ?', [province_id, room_id], function(updateErr) {
          if (updateErr) {
            console.log('admin province error', updateErr);
            return res.status(500).send('Error assigning provinces');
          }
  
          if ((index + 1) % province_n === 0) {
            province_id++;
          }
  
          updateProvince(index + 1);
        });
      };
  
      updateProvince(0);
    });
  });
  


  // 방 생성하고 랜덤으로 유저 배치
  router.post('/make_all_room', function(req, res, next) {
    var type_val = req.body.type_val;
    var from_room, to_room;
    db.query('INSERT INTO game_info (game_type) VALUES(?)', [type_val], function(err, result) { // make game room to get room id
      if (err) {
        console.log('admin make all room', err);
      }
      else {
        db.query('SELECT room_id FROM game_info', function(err2, game_list) { // for next game room id
          if (err2) {
            console.log('admin make all room', err2);
          }
          else {
            var next_room_id;
            next_room_id = game_list[game_list.length - 1].room_id; // get room number
            from_room = next_room_id;
            db.query('SELECT id, room FROM users', function(err3, user_list) {
              if (err3) {
                console.log('admin make all room', err3);
              }
              else {
                // shuffle user
                var ctr = user_list.length, temp, index;
                while (ctr > 0) {
                    index = Math.floor(Math.random() * ctr);
                    ctr--;
                    temp = user_list[ctr];
                    user_list[ctr] = user_list[index];
                    user_list[index] = temp;
                }
                // console.log(user_list);

                var user_cnt = 4; // 4 per room
                var local_user_cnt = 0;
                for (var i = 0; i < user_list.length; ++i) {
                  if (user_list[i].room != 0)
                    continue;
                  
                  var now_user_id = user_list[i].id
                  db.query('UPDATE users SET room=?, status=? WHERE id=?', [next_room_id, 1, now_user_id], function(err4, result) {
                    if (err4) {
                      console.log('admin make all room', err4);
                      res.send('fail');
                    }
                  });
                  --user_cnt;
                  ++local_user_cnt;
                  
                  if (user_cnt == 0 || i == user_list.length - 1) { // room info - user count 업데이트
                    db.query('UPDATE game_info SET user_cnt=? WHERE room_id=?', [local_user_cnt, next_room_id], function(err7, result) {
                      if (err7) {
                        console.log('admin make all room', err7);
                        res.send('fail');
                      }
                    });
                    local_user_cnt = 0;
                  }

                  if (user_cnt == 0) { // 4명 다 채움
                    db.query('INSERT INTO game_info (game_type) VALUES(?)', [type_val], function(err2, result) {
                      if (err2) {
                        console.log('admin make all room', err2);
                        res.send('fail');
                      }
                    });
                    user_cnt = 4;
                    next_room_id += 1;
                  }
                }
                // set room parameter
                to_room = next_room_id;
                var sql_parameter;
                var sql_parameter = 'SELECT * FROM disaster_parameter';
                db.query(sql_parameter, function(err5, parameters) {
                  if (err5) {
                    console.log('admin', err5);
                  }
                  else {
                    var game_parameter_sql;
                    var game_parameter_parameter;

                    game_parameter_sql = 'INSERT INTO game_parameter (room_id, init_w, adjusted_w, price_var, init_budget, disaster_probability, isdisasteroccured,\
                        first_disaster, second_disaster, total_energy, disaster_number) \
                      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
                    
                    game_parameter_parameter = [next_room_id, parameters[0].init_w, parameters[0].adjusted_w, parameters[0].price_var, parameters[0].init_budget, 
                    parameters[0].disaster_probability, parameters[0].isdisasteroccured, parameters[0].first_disaster, parameters[0].second_disaster, parameters[0].total_energy, parameters[0].disaster_number];
                    
                    for (var temp = from_room; temp <= to_room; ++temp) {
                      var now_paramter = game_parameter_parameter;
                      now_paramter[0] = temp;
                      db.query(game_parameter_sql, now_paramter, function(err6, result) {
                        if (err6) {
                          console.log('admin', err6);
                        }
                      });
                    }
                    res.send('done');
                  }
                });  
              }   
            });
          }
        });
      }
    });
  });

  // 새로고침 하면 방을 불러옴
  router.post('/load_game_info', function(req, res, next) {
    var var_room_html = "";
    db.query('SELECT room_id, province_id, game_type, room_status FROM game_info', function(err, game_list) {
      if (err) {
        console.log('admin', err);
      }
      else {
        db.query('SELECT id, room, status FROM users', function(err2, user_list) {
          if (err2) {
            console.log('admin', err2);
          }
          else {
            db.query("SELECT room_id, COUNT(room_id) AS round FROM game_record WHERE id='admin' GROUP BY room_id", function(err3, game_round) {
              if (err2) {
                console.log('admin load game info', err2);
              }
              else {
                var room_round_cnt = {};
                for (var i = 0; i < game_round.length; ++i) {
                  room_round_cnt[game_round[i].room_id] = game_round[i].round;
                }
                for (var i = 0; i < game_list.length; ++i) { // 방 네모 박스 생성
                  var now_game_info = game_list[i];
                  var now_room_stauts = now_game_info.room_status;
                  var wrap_room_id = "wrap_room" + now_game_info.room_id;
                  var round_room_id = "Round" + now_game_info.room_id;
                  var room_province_id = "Province" + now_game_info.province_id;
                  var now_round = (now_game_info.room_id in room_round_cnt ? room_round_cnt[now_game_info.room_id] : 1);
                  var_room_html += `
                  <div class="col-md-3 mb-3" id=${wrap_room_id}>
                    <div class="card text-center">
                      <div class="card-header" > Province: ${now_game_info.province_id}, Room: ${now_game_info.room_id}, Type: ${now_game_info.game_type}, Round: <span id=${round_room_id}>${now_round}</span> <button type="button" class="delete_room_class close ml-auto" data-id=${now_game_info.room_id}> <span>x</span> </button> </div>
                      <div class="card-body" id=${now_game_info.room_id}>`;
                  
                  for (var j = 0; j < user_list.length; ++j) { // 사용자 상태 창
                    var now_user_info = user_list[j];
                    var user_status_id = 'status' + now_user_info.id;
                    var temp = now_user_info.status;
                    var now_user_status;
                    if (temp == 1)
                      now_user_status = 'wait';
                    else if (temp == 2)
                      now_user_status = 'ready';
                    else if (temp == 3)
                      now_user_status = 'start';
                    else if (temp == 4)
                      now_user_status = 'stop';
                    else if (temp == 5)
                      now_user_status = 'end';
                    if (now_game_info.room_id == now_user_info.room) {
                      var selected_user_val_id = 'room' + now_user_info.id;
                      var_room_html += `
                      <div class="row border-bottom" id=${selected_user_val_id}>
                        <b>${now_user_info.id}</b><b class="ml-auto" id=${user_status_id}>${now_user_status}</b><button type="button" class="delete_user_room_class close pl-3" data-id=${now_user_info.id}> <span>-</span> </button>
                      </div>`;
                    }
                  }

                  // 버튼 생성
                  var start_room_id = 'start' + now_game_info.room_id;
                  var stop_room_id = 'stop' + now_game_info.room_id;
                  var_room_html += `
                      </div>
                      <div class="card-footer text-muted">`;
                  if (now_room_stauts == 2) { // 중단
                  var_room_html += `
                        <button class="start_room_class btn btn-primary" data-id=${now_game_info.room_id} id=${start_room_id}>${res.__('restart')}</button>
                        <button class="stop_room_class btn btn-primary" data-id=${now_game_info.room_id} id=${stop_room_id} disabled>${res.__('stop')}</button>`;
                  }
                  else if (now_room_stauts == 1) { // 시작 중
                  var_room_html += `
                        <button class="start_room_class btn btn-primary" data-id=${now_game_info.room_id} id=${start_room_id} disabled>${res.__('restart')}</button>
                        <button class="stop_room_class btn btn-primary" data-id=${now_game_info.room_id} id=${stop_room_id}>${res.__('stop')}</button>`;
                  }
                  else if (now_room_stauts == 3) { // 종료
                  var_room_html += `
                        <button class="start_room_class btn btn-primary" data-id=${now_game_info.room_id} id=${start_room_id} disabled>${res.__('restart')}</button>
                        <button class="stop_room_class btn btn-primary" data-id=${now_game_info.room_id} id=${stop_room_id} disabled>${res.__('stop')}</button>`;
                  }
                  else if (now_room_stauts == 0) { // 시작 전
                  var_room_html += `
                        <button class="start_room_class btn btn-primary" data-id=${now_game_info.room_id} id=${start_room_id}>${res.__('start')}</button>
                        <button class="stop_room_class btn btn-primary" data-id=${now_game_info.room_id} id=${stop_room_id} disabled>${res.__('stop')}</button>`;
                  }
                  var_room_html += `
                      </div>
                    </div>
                  </div>`;
                }
    
                res.send(var_room_html);
              }
            });
          }
        });
      }
    });
  });

  // 오른쪽 사용자 불러옴
  router.post('/load_user_info', function(req, res, next) {
    var var_user_html = "";
    db.query('SELECT id, room FROM users', function(err, user_list) {
      if (err) {
        console.log('admin load user', err);
      }
      else {
        for (var i = 0; i < user_list.length; ++i) {
          var now_user_info = user_list[i];
          if (now_user_info.room != 0)
            continue;
          var_user_html += `
          <div class="row border-bottom" id=${now_user_info.id}>
            <b>${now_user_info.id}</b><button type="button" class="add_user_room_class close ml-auto" data-toggle="modal" data-target="#add_user_room" data-id=${now_user_info.id}> <span>+</span> </button>
          </div>`;
        }

        res.send(var_user_html);
      }
    });
  });

  // 사용자 방에 넣는 창 불러옴
  router.post('/load_room_number', function(req, res, next) {
    var var_room_number_html = "";
    db.query('SELECT room_id, user_cnt FROM game_info', function(err, game_list) {
      if (err) {
        console.log('admin', err);
      }
      else { 
        for (var i = 0; i < game_list.length; ++i) {
          if (game_list[i].user_cnt >= 4)
            continue
          var_room_number_html += `<option value="${game_list[i].room_id}">${game_list[i].room_id}</option>`;
        }
        res.send(var_room_number_html);
      }
    });
  });

  // 유저를 방에 넣음
  router.post('/user_2_room', function(req, res, next) {
    var room_number_val = req.body.room_number_val;
    var selected_user_val = req.body.selected_user_val;
    var selected_user_val_id = 'room' + selected_user_val;
    var status_id = 'status' + selected_user_val;
    db.query('SELECT user_cnt FROM game_info WHERE room_id=?', [room_number_val], function(err5, result5) {
      var now_user_cnt = result5[0].user_cnt;
      if (err5) {
        console.log('admin', err5);
      }
      else if (now_user_cnt < 4) {
        db.query('UPDATE game_info SET user_cnt=? WHERE room_id=?', [now_user_cnt + 1, room_number_val], function(err2, result) {
          if (err2) {
            console.log('admin', err2);
          }
          else {
            db.query('UPDATE users SET room=?, status=? WHERE id=?', [room_number_val, 1, selected_user_val], function(err, result) {
              if (err) {
                console.log('admin', err);
              }
              else {
                var var_room_user_html = `
                <div class="row border-bottom" id=${selected_user_val_id}>
                  <b>${selected_user_val}</b><b class="ml-auto" id=${status_id}>wait</b><button type="button" class="delete_user_room_class close pl-3" data-id=${selected_user_val}> <span>-</span> </button>
                </div>`;
                io.message(io.user_2_socket_id[selected_user_val], 'reload_as_status_change', '');
                res.send(var_room_user_html);
              }
            });
          }
        });
      }
    });
  });

  // 유저를 방에서 빼냄
  router.post('/out_user_room', function(req, res, next) {
    var selected_user_val = req.body.selected_user_val;
    db.query('SELECT status, room FROM users WHERE id=?', [selected_user_val], function(err5, result5) {
      if (err5) {
        console.log('admin out user', err5);
      }
      else if (result5[0].status == 1 || result5[0].status == 2) { // in room - user wait, ready
        db.query('SELECT user_cnt FROM game_info WHERE room_id=?', [result5[0].room], function(err4, result4) {
          if (err4) {
            console.log('admin out user', err4);
          }
          else {
            db.query('UPDATE users SET room=?, status=? WHERE id=?', [0, 0, selected_user_val], function(err, result) {
              if (err) {
                console.log('admin out user', err);
              }
              else {
                db.query('UPDATE game_info SET user_cnt=? WHERE room_id=?', [result4[0].user_cnt - 1, result5[0].room], function(err3, result3) {
                  if (err3) {
                    console.log('admin out user', err3);
                  }
                  else {
                    var var_room_user_html = `
                    <div class="row border-bottom" id=${selected_user_val}>
                      <b>${selected_user_val}</b><button type="button" class="add_user_room_class close ml-auto" data-toggle="modal" data-target="#add_user_room" data-id=${selected_user_val}> <span>+</span> </button>
                    </div>`;
                    io.message(io.user_2_socket_id[selected_user_val], 'reload_as_status_change', '');
                    res.send(var_room_user_html);
                  }
                });
              }
            });
          }
        });
      }
    });
  });

  // 방 삭제
  router.post('/delete_room', function(req, res, next) { // delete game parameter ?
    var selected_room_val = req.body.selected_room_val;
    db.query('SELECT room_status FROM game_info WHERE room_id=?', [selected_room_val], function(err5, result) {
      if (err5) {
        console.log('admin', err5);
      }
      else if (result[0].room_status != 1) { // in case of the before game, stopped game or game end
        db.query('DELETE FROM game_info WHERE room_id=?', [selected_room_val], function(err, result) {
          if (err) {
            console.log('admin', err);
          }
          else {
            db.query('SELECT id FROM users WHERE room=?', [selected_room_val], function(err2, result2) {
              if (err2) {
                console.log('admin', err2);
              }
              else {
                db.query('UPDATE users SET room=?, status=? WHERE room=?', [0, 0, selected_room_val], function(err3, result3) {
                  if (err3) {
                    console.log('admin', err3);
                  }
                  else {
                    var var_room_user_html = '';
                    for (var i = 0; i < result2.length; ++i) {
                      var now_id = result2[i].id;
                      var_room_user_html += `
                      <div class="row border-bottom" id=${now_id}>
                        <b>${now_id}</b><button type="button" class="add_user_room_class close ml-auto" data-toggle="modal" data-target="#add_user_room" data-id=${now_id}> <span>+</span> </button>
                      </div>`;
                      io.message(io.user_2_socket_id[now_id], 'reload_as_status_change', '');
                    }
                    res.send(var_room_user_html);
                  }
                });
              }
            });
          }
        });
      }
    });
  });

  // 게임 시작
  router.post('/start_room', function(req, res, next) {
    var selected_room_val = req.body.selected_room_val;
    db.query('SELECT id, status FROM users WHERE room=?', [selected_room_val], function(err, user_list) {
      if (err) {
        console.log('admin start room', err);
      }
      else if (user_list.length <= 4) { // 4인 미만만 시작 가능
        var check_status = true;
        for (var i = 0; i < user_list.length; ++i) { // all user ready
          if (user_list[i].status !== 2) {
            check_status = false;
            break;
          }
        }

        if (check_status) {
          db.query('UPDATE game_info SET room_status=1 WHERE room_id=?', [selected_room_val], function(err3, result3) {
            if (err3) {
              console.log('admin start room', err3);
            }
            else {
              db.query('UPDATE users SET status=3 WHERE room=?', [selected_room_val], function(err2, result) {
                if (err2) {
                  console.log('admin start room', err2);
                }
                else {
                  db.query("INSERT INTO game_record (round, id, room_id, start_time) VALUES(1, 'admin', ?, ?)", [selected_room_val, Date.now()], function(err3, result) {
                    if (err3) {
                      console.log('game start error', err3);
                    }
                    else {
                      game_control.make_room_timer(selected_room_val, 2, io); // 제한 시간 만들고 사용자들에게 알림
                      for (var i = 0; i < user_list.length; ++i) {
                        var now_id = user_list[i].id;
                        io.message(io.user_2_socket_id['admin'], 'change_user_status', {
                          user_id:now_id,
                          status:'3'
                        });
                        io.message(io.user_2_socket_id[now_id], 'reload_as_status_change', '');
                      }
                      res.send('success')
                    }
                  });
                }
              });
            }
          });
        }
      }
    });
  });

  // 게임을 멈춤
  router.post('/stop_room', function(req, res, next) {
    var selected_room_val = req.body.selected_room_val;
    game_control.stop_room_timer(selected_room_val);

    db.query('SELECT id FROM users WHERE room=?', [selected_room_val], function(err, user_list) {
      if (err) {
        console.log('stop game err', err);
      }
      else {
        db.query('UPDATE users SET status=4 WHERE room=?', [selected_room_val], function(err2, result) {
          if (err2) {
            console.log('stop game err', err2);
          }
          else {
            for (var i = 0; i < user_list.length; ++i) {
              io.message(io.user_2_socket_id[user_list[i].id], 'stop_user', res.__('game_stop_explanation'));
            }
            db.query('UPDATE game_info SET room_status=2 WHERE room_id=?', [selected_room_val], function(err3, result) {
              if (err3)
                console.log('stop game err', err3);
              res.send('');
            });
          }
        });
      }
    });
  });

  // 재시작
  router.post('/restart_room', function(req, res, next) {
    var selected_room_val = req.body.selected_room_val;
    db.query('SELECT id FROM users WHERE room=?', [selected_room_val], function(err, user_list) {
      if (err) {
        console.log('admin restart ', err);
      }
      else {
        db.query("SELECT round FROM game_record WHERE id='admin' AND room_id=?", [selected_room_val], function(err3, round_info) {
          if (err3) {
            console.log('admin restart', err3);
          }
          else {
            var cur_round = round_info.length;
            db.query("UPDATE game_record SET start_time=? WHERE round=? AND id='admin' AND room_id=?", [Date.now(), cur_round, selected_room_val], function(err4, result) {
              if (err4) {
                console.log('admin restart', err4);
              }
              else {
                db.query('UPDATE users SET status=3 WHERE room=?', [selected_room_val], function(err2, result) {
                  if (err2) {
                    console.log('admin', err2);
                  }
                  else {
                    db.query('UPDATE game_info SET room_status=1 WHERE room_id=?', [selected_room_val], function(err3, result) {
                      if (err3)
                        console.log('admin game end err', err3);
                      else {
                        if (cur_round <= 32) // 5 + 1 (연습), 5 + 1 + 1 / 5 + 1 + 1 / 5 + 1 + 1/ 5 is end, 게임 제한 시간을 만들고 사용자에게 알림
                          game_control.make_room_timer(selected_room_val, cur_round + 1, io);
                        for (var i = 0; i < user_list.length; ++i) {
                          var now_id = user_list[i].id;
                          io.message(io.user_2_socket_id['admin'], 'change_user_status', {
                            user_id:now_id,
                            status:'3'
                          });
                          io.message(io.user_2_socket_id[now_id], 'reload_as_status_change', '');
                        }
                        res.send('success');
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
  });

// 게임 기록 csv 다운로드
router.post('/download_record', function(req, res, next) {
  // game_record 테이블에서 모든 게임 기록을 가져와 room_id, round, id 순으로 정렬
  db.query("SELECT * FROM game_record ORDER BY room_id, round, id", function(err, result) {
      if (err) {
          console.log('write game record', err); // 오류 발생 시 로그 출력
      } else {
          // 결과를 JSON 형식으로 변환
          var jsonData = JSON.parse(JSON.stringify(result));
          var admin_start_time = {}; // 관리자가 시작한 시간을 저장할 객체

          // 관리자가 시작한 시간을 가져옴 (admin의 start_time)
          for (var i = 0; i < jsonData.length; ++i) {
              if (jsonData[i]['id'] == 'admin') {
                  var admin_key = jsonData[i]['round'] + '_' + jsonData[i]['room_id']; // 라운드와 방 ID를 key로 사용
                  admin_start_time[admin_key] = jsonData[i]['start_time']; // 해당 라운드의 시작 시간을 기록
              }
          }

          var writeData = []; // CSV에 쓸 데이터를 저장할 배열
          for (var i = 0; i < jsonData.length; ++i) {
              if (jsonData[i]['id'] == 'admin') // 관리자 기록은 무시
                  continue;

              var admin_key = jsonData[i]['round'] + '_' + jsonData[i]['room_id']; // 해당 라운드와 방 ID의 key 설정
              // 사용자가 제출한 시간을 계산 (관리자의 시작 시간에서 사용자의 제출 시간을 뺌)
              jsonData[i]['start_time'] = Math.floor((jsonData[i]['start_time'] - admin_start_time[admin_key]) / 1000);

              // Practice 라운드 처리
              if (jsonData[i]['round'] >= 1 && jsonData[i]['round'] < 6)
                  jsonData[i]['round'] = 'Practice';

              // Practice Contribution 라운드
              else if (jsonData[i]['round'] == 6)
                  jsonData[i]['round'] = 'Practice Contribution';

              // 7라운드를 제거하고 8~12 라운드 -> 7~11로 이동
              else if (jsonData[i]['round'] > 6 && jsonData[i]['round'] < 12)
                  jsonData[i]['round'] -= 6;

              // 커뮤니티 프로젝트 Contribution 라운드 (12, 19, 26)
              else if (jsonData[i]['round'] == 12 || jsonData[i]['round'] == 19 || jsonData[i]['round'] == 26)
                  jsonData[i]['round'] = 'Contribution';

              // 커뮤니티 프로젝트 Satisfaction 라운드 (13, 20, 27)
              else if (jsonData[i]['round'] == 13 || jsonData[i]['round'] == 20 || jsonData[i]['round'] == 27)
                  jsonData[i]['round'] = 'Satisfaction';

              // 14~18 라운드는 7~11로 이동
              else if (jsonData[i]['round'] > 13 && jsonData[i]['round'] < 19)
                  jsonData[i]['round'] -= 10;

              // 21~25 라운드는 9~14로 이동
              else if (jsonData[i]['round'] > 20 && jsonData[i]['round'] < 26)
                  jsonData[i]['round'] -= 12;

              // 수정된 데이터를 writeData 배열에 추가
              writeData.push(jsonData[i]);
          }

          // 현재 시간을 기준으로 csv 파일 이름 생성
          var now_time = new Date();
          var csv_file_name = "game_record_" + now_time.getDate() + "_" + now_time.getHours() + "_" + now_time.getMinutes() + ".csv";

          // CSV 파일 생성 및 기록
          const ws = fs.createWriteStream(csv_file_name);
          fastcsv
              .write(writeData, { headers: true }) // 헤더와 함께 데이터를 CSV에 작성
              .on("finish", function() {
                  console.log("Write to game_record.csv successfully!"); // 완료 후 로그 출력
                  res.send(''); // 응답 전송
              })
              .pipe(ws); // CSV 데이터를 파일에 기록
        }
    });
  });
  
  return router;
}
