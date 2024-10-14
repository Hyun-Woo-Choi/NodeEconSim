var express = require('express');
const { check, validationResult } = require('express-validator');
var _ = require('lodash');
var db = require('../lib/mysql_');
var game_control = require('../lib/game_control');

module.exports = function(io) {
  var router = express.Router();
  
  router.get('/', function(req, res, next) { // 게임 중 화면에 보이는 기능 및 수치
    // 세션에 사용자 ID가 없거나 관리자인 경우 리다이렉트
    if (!req.session.user_id || req.session.user_id === 'admin') {
      return res.redirect('/');
    } else {
      // 사용자의 언어 쿠키 설정 (기본값: 'ko')
      var var_cookie_lang = req.cookies.lang || 'ko';
      res.cookie('lang', var_cookie_lang);
  
      // game_input_status 쿠키 값을 설정하고, 기존 값을 제거
      var var_game_input_status = req.cookies.game_input_status || '';
      res.clearCookie('game_input_status');
  
      // 데이터베이스에서 현재 사용자의 정보 조회
      db.query('SELECT room, status, wait_other FROM users WHERE id=?', [req.session.user_id], function(err, user_info) {
        if (err) {
          console.error(err, req.session.user_id); // 오류 발생 시 로그 출력
          return next(err);
        } else {
          var user_room = user_info[0].room; // 사용자의 room ID 저장
          var var_user_status = user_info[0].status; // 사용자의 상태 저장
          var var_is_wait = Number(user_info[0].wait_other); // 사용자의 wait_other 값 저장
  
          ///////////////////////////////////////////////////////////////////////////////////////////////////// 사용자 기록 테이블 
          // 상태가 0, 1, 2인 경우 '/users'로 리다이렉트
          if (var_user_status === 1 || var_user_status === 2 || var_user_status === 0) {
            return res.redirect('/users');
          } else {
            // game_record 테이블에서 사용자의 기록과 관리자(admin)의 기록을 조회
            db.query("SELECT id, start_time, round, input_one, total_one, price_one, budget, profit FROM game_record WHERE room_id=? AND (id=? OR id='admin') ORDER BY round", [user_room, req.session.user_id], function(err4, all_game_record) {
              if (err4) {
                console.error(err4, req.session.user_id); // 오류 발생 시 로그 출력
                return next(err4);
              } else {
                var user_game_record = []; // 사용자의 게임 기록 저장
                var admin_start_time; // 관리자의 시작 시간 저장
                var now_round = 0; // 현재 라운드 저장
  
                // game_record에서 관리자의 시작 시간과 현재 라운드 계산
                all_game_record.forEach(record => {
                  if (record.id == 'admin') {
                    admin_start_time = record.start_time; // 관리자의 시작 시간 설정
                    now_round += 1; // 관리자의 기록이 있을 때마다 라운드 증가
                  } else {
                    user_game_record.push(record); // 사용자의 기록을 저장
                  }
                });
  
                // 남은 시간을 계산 (120초에서 경과 시간 차감)
                var remain_time = 120 - Math.floor((Date.now() - admin_start_time) / 1000);
  
                var game_record_html = ''; // 게임 기록을 HTML로 변환하여 저장
                var now_budget = 0; // 현재 예산 저장
                var community_input = 0; // 커뮤니티 입력값 저장
                var budget_limit = 0; // 예산 제한 저장
  
                if (user_game_record.length > 0) {
                  // 현재 라운드 이전의 기록만 필터링
                  var previous_game_record = user_game_record.filter(record => record.round < now_round);
              
                  // 라운드가 7 이상일 경우 1~6 라운드를 제외
                  if (now_round >= 7) {
                    previous_game_record = previous_game_record.filter(record => record.round > 6);
                  }
  
                  // 특정 라운드 제외 (6, 12, 13, 19, 20, 26, 27 라운드)
                  previous_game_record = previous_game_record.filter(record => ![6, 12, 13, 19, 20, 26, 27].includes(record.round));
              
                  if (previous_game_record.length > 0) {
                    // 테이블 헤더 설정 (언어에 따라 다르게 설정)
                    var show_table_key = var_cookie_lang === 'ko' ? ['라운드', '전기 구입량', '그룹 총 구입량', '제품 가격', '예산', '이윤'] : ['Round', 'My Electricity', 'Group Electricity', 'Price', 'Budget', 'Profit'];
              
                    // 게임 기록 테이블 HTML 생성
                    game_record_html = `<div class="table-responsive">
                                        <table class="table table-bordered table-sm">
                                        <thead class="thead-dark">
                                        <tr>`;
              
                    show_table_key.forEach(key => {
                      game_record_html += `<th style="text-align: center;">${key}</th>`;
                    });
              
                    game_record_html += `</tr></thead><tbody>`;
              
                    // 이전 라운드의 게임 기록을 테이블에 표시
                    previous_game_record.forEach((record) => {
                      game_record_html += `<tr>`;
              
                      // 라운드 값을 변환
                      var round = record.round;
                      if (round > 12 && round < 19) {
                        round -= 8;
                      } else if (round > 19 && round < 26) {
                        round -= 10;
                      } else if (round > 5 && round <= 12) {
                        round -= 6;
                      } else if (round > 26) {
                        round -= 12;
                      }
  
                      game_record_html += `<td style="text-align: center;">${round}</td>`;
              
                      // 다른 기록 표시
                      for (var record_key in record) {
                        if (['id', 'start_time'].includes(record_key)) continue;
                        if (record_key !== 'round') {
                          game_record_html += `<td style="text-align: center;">${record[record_key]}</td>`;
                        }
                      }
                      game_record_html += `</tr>`;
                    });
              
                    game_record_html += `</tbody></table></div>`;
  
                    // 최신 게임 기록을 기준으로 현재 예산, 커뮤니티 입력, 예산 제한 설정
                    now_budget = previous_game_record[previous_game_record.length - 1].budget;
                    community_input = previous_game_record[previous_game_record.length - 1].input_one;
                    budget_limit = Math.max(now_budget, 0);
                  }
                }

                 ///////////////////////////////////////////////////////////////////////////////////////////////////// 이웃 그룹 완료 여부 확인
  
                // province_id를 조회하여 게임 상태를 확인
                db.query('SELECT province_id FROM game_info WHERE room_id=?', [user_room], function(err, rows) {
                  if (err) {
                    console.error(err, req.session.user_id); // 오류 발생 시 로그 출력
                    return next(err);
                  } else {
                    var province_id = rows[0].province_id;
  
                    // 같은 province_id를 가진 방의 room_submit 상태 조회
                    db.query('SELECT room_submit, room_id FROM game_info WHERE province_id=? AND room_id != ?', [province_id, user_room], function(err, room_submit_list) {
                      if (err) {
                        console.error(err, req.session.user_id); // 오류 발생 시 로그 출력
                        return next(err);
                      } else {
                        // room_submit 상태에 따른 HTML 생성
                        var room_submit_html = room_submit_list.map((room, i) => {
                          var badge_class = room.room_submit === 1 ? 'badge-success' : 'badge-danger';
                          return `<span class="badge ${badge_class}">Group ${i + 1}</span>`;
                        }).join(' ');
  
                        var community_round;
  
                        // 커뮤니티 라운드 계산 (라운드 범위에 따른 값 설정)
                        if (now_round > 7 && now_round < 19) {
                          community_round = 12;
                        } else if (now_round > 19 && now_round < 26) {
                          community_round = 19;
                        } else if (now_round > 26) {
                          community_round = 26;
                        }
  
                        // total_energy_record 테이블에서 에너지 기록 조회
                        db.query('SELECT * FROM total_energy_record WHERE province_id = ? AND round = ?', [province_id, community_round], function(err_total, energy_submit_list) {
                          if (err_total) {
                            console.error(err_total);
                            return next(err_total);
                          } else {
                            // 에너지 관련 값 계산
                            var total_energy_list = energy_submit_list.map(energy => energy.total_energy);
                            var total_energy_div_4_list = energy_submit_list.map(energy => energy.total_energy / 4);
                            var total_energy_div_140_list = energy_submit_list.map(energy => Math.floor(energy.total_energy / 140));


                            ///////////////////////////////////////////////////////////////////////////////////////////////////// 같은 그룹의 사용자 제출 여부 확인
  
                            // 다른 사용자의 상태 조회
                            db.query("SELECT wait_other FROM users WHERE room=? AND id!=?", [user_room, req.session.user_id], function(err3, other_user_list) {
                              if (err3) {
                                console.error(err3, req.session.user_id);
                                return next(err3);
                              } else {
                                // 다른 사용자들의 상태를 표시하는 HTML 생성
                                var other_user_status_html = other_user_list.map((user, i) => {
                                  var html_id = 'other_user_status_' + (i + 1);
                                  var status_badge = user.wait_other == 1 ? `<span class="badge badge-primary" id=${html_id}>${res.__('other_submit')}</span>` : `<span class="badge badge-danger" id="${html_id}">${res.__('other_wait')}</span>`;
                                  return `<tr><td>${i + 1}</td><td>Player${i + 1}</td><td>${status_badge}</td></tr>`;
                                }).join('');
  
                                // game_parameter와 game_info 테이블에서 게임 설정 및 유형 조회
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
                                        var game_parameters = game_parameter[0]; // 게임 파라미터 설정
                                        var production_price = `${res.__('game_user_Cost')}${game_parameters.price_var} - ${res.__('game_user_Num')}`; // 생산 비용 설정
                                        var user_prev_round = now_round - 1; // 이전 라운드 설정
  
                                        // 이전 라운드의 기록 조회
                                        db.query("SELECT budget, input_one FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [user_prev_round, user_room], function(err4, prev_game_record) {
                                          if (err4) {
                                            console.error(err4, req.session.user_id);
                                            return next(err4);
                                          } else {
                                            // 예산 관련 값 계산
                                            var budgets = prev_game_record.map(record => record.budget);
                                            var largest_budget = Math.max(...budgets);
                                            var smallest_budget = Math.min(...budgets);
                                            var total_one = budgets.reduce((sum, budget) => sum + budget, 0);
                                            var mean_value = total_one / budgets.length;
  
                                            // 커뮤니티 라운드의 input 값 조회
                                            db.query("SELECT input_one, room_id FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [community_round, user_room], function(err4, community_round_record) {
                                              if (err4) {
                                                console.error(err4, req.session.user_id);
                                                return next(err4);
                                              } else {
                                                var inputs = community_round_record.map(record => record.input_one);
                                                var total_contribution = community_round_record.reduce((sum, record) => sum + record.input_one, 0);
                                                var mean_contribution = total_contribution / community_round_record.length;
                                                var usable_electrocity = Math.floor(total_contribution / 140); // 사용 가능한 전력 계산
  
                                                // game.ejs 템플릿을 렌더링하여 응답
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
                                                  total_energy_div_4_list: total_energy_div_4_list,
                                                  total_energy_div_140_list: total_energy_div_140_list
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
  


  router.get('/ko', function(req, res, next) { // 한국어 설정
    res.cookie('lang', 'ko');
    res.redirect('/game');
  });

  router.get('/en', function(req, res, next) { // 영어 설정
    res.cookie('lang', 'en');
    res.redirect('/game');
  });

  router.get('/signout', function(req, res, next) { // 로그아웃
    req.session.destroy(function(err) {
      if (err) {
        console.error(err);
      }
      res.redirect('/');
    });
  });

  router.post('/submit_round', [ 
    // 사용자가 입력한 값에 대한 유효성 검사 (0에서 9999999 사이의 정수)
    check('input_one').isInt({ min: 0, max: 9999999 }),
    check('input_two').isInt({ min: 0, max: 9999999 })
], function(req, res, next) {
    // 유효성 검사 결과 확인
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        // 유효성 검사 실패 시 쿠키에 메시지를 저장하고 '/game'으로 리다이렉트
        res.cookie('game_input_status', res.__('game_int_status'));
        return res.redirect('/game');
    } else {
        var post = req.body;
        var input_one = post.input_one; // 사용자가 입력한 input_one 값
        var input_two = post.input_two; // 사용자가 입력한 input_two 값
        var round = Number(post.round); // 현재 라운드
        var room_number = post.room_number; // 사용자의 room 번호

        // 게임 파라미터 조회
        db.query('SELECT * FROM game_parameter WHERE room_id=?', [room_number], function(err, game_parameter) {
            if (err) {
                console.error(err, req.session.user_id); // 오류 로그 출력
                return next(err);
            } else {
                var game_params = game_parameter[0]; // 게임 파라미터
                var init_budget = Number(game_params.init_budget); // 초기 예산
                var init_w = Number(game_params.init_w); // 초기 w
                var total_energy = Number(game_params.total_energy); // 총 에너지
                var is_disaster_occurred = game_params.isdisasteroccured; // 재난 발생 여부
                var budget = Number(post.budget); // 기여도를 계산 (음수는 0으로)

                // 입력 유효성 검사 (특정 라운드의 제한된 값 설정)
                if ((round === 1) && (input_one > 20)) { // 라운드 1에서 input_one이 20 초과
                    res.cookie('game_input_status', res.__('game_input_status'));
                    return res.redirect('/game');
                } else if ((round === 13 || round === 20 || round == 27) && input_one > 7) { // 공동체 만족도 조사, 0~7까지만 만들어놔서 나올 가능성 없음.
                    res.cookie('game_input_status', res.__('predicted_input_disaster'));
                    return res.redirect('/game');
                } else if ((round === 6 || round === 12 || round === 19 || round == 26) && input_one > budget) { // 기여도 예산 초과 제한
                    res.cookie('game_input_status', res.__('game_input_contribution_status'));
                    return res.redirect('/game');
                } else if ((round === 6 || round === 12 || round === 19 || round == 26) && input_two > 10) { // 재난 라운드 input_two 제한
                    res.cookie('game_input_status', res.__('predicted_input_disaster'));
                    return res.redirect('/game');
                } else if (![1, 6, 12, 13, 19, 20, 26, 27].includes(round) && is_disaster_occurred === 1 && round > 13 && (input_one > Math.floor(total_energy / 4))) { // 재난 발생 시 제한
                    res.cookie('game_input_status', res.__('game_disaster_status'));
                    return res.redirect('/game');
                } else if (![1, 6, 12, 13, 19, 20, 26, 27].includes(round) && is_disaster_occurred === 0 && (input_one > 20)) { // 일반 라운드에서 input_one 제한
                    res.cookie('game_input_status', res.__('game_input_status'));
                    return res.redirect('/game');
                } else {
                    // 중복 확인: 동일한 라운드, id, room_id로 이미 제출된 기록이 있는지 확인
                    db.query('SELECT * FROM game_record WHERE round=? AND id=? AND room_id=?', 
                        [round, req.session.user_id, room_number], function(err, result) {
                        if (err) {
                            console.error('check duplicate error', err); // 오류 로그 출력
                            return res.redirect('/game');
                        } else if (result.length > 0) {
                            // 중복된 기록이 있을 경우 경고 메시지 설정
                            res.cookie('game_input_status', res.__('duplicate_entry')); // 여기서 자꾸 중복 제출되는 상황 종종 발생. 
                            return res.redirect('/game');
                        } else {
                            // 게임 기록 삽입
                            db.query('INSERT INTO game_record (round, id, room_id, start_time, input_one, input_two) VALUES (?, ?, ?, ?, ?, ?)', 
                                [round, req.session.user_id, room_number, Date.now(), input_one, input_two], function(err, result) {
                                if (err) {
                                    console.error('user insert game error', err); // 오류 로그 출력
                                    return res.redirect('/game');
                                } else {
                                    // 사용자의 wait_other 값을 1로 설정
                                    db.query('UPDATE users SET wait_other=1 WHERE id=?', [req.session.user_id], function(err3) {
                                        if (err3) {
                                            console.error('during game, user insert error', err3); // 오류 로그 출력
                                            return res.redirect('/game');
                                        } else {
                                            // 같은 방에 있는 다른 사용자들에게 알림
                                            db.query('SELECT id FROM users WHERE room=?', [room_number], function(err2, user_info) {
                                                if (err2) {
                                                    console.error('user get after insert game error', err2);
                                                    return res.redirect('/game');
                                                } else {
                                                    user_info.forEach(user => {
                                                        if (user.id != req.session.user_id) {
                                                            io.message(io.user_2_socket_id[user.id], 'other_user_submit', ''); // 다른 사용자에게 메시지 전송
                                                        }
                                                    });

                                                    // 게임 기록에서 같은 라운드에 제출된 사용자들의 수 확인
                                                    db.query("SELECT id FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [round, room_number], function(err3, user_submit_list) {
                                                        if (err3) {
                                                            console.error('user get after insert game error', err3);
                                                            return res.redirect('/game');
                                                        } else {
                                                            // 방의 모든 사용자가 제출을 완료했을 경우
                                                            if (user_info.length === user_submit_list.length) { 
                                                                // 라운드가 12, 19, 26이면 같은 province에 있는 모든 방의 상태 업데이트
                                                                if (round == 12 || round == 19 || round == 26) {
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
                                                                                    // 동일한 province_id를 가진 모든 방이 완료되었는지 확인
                                                                                    db.query('SELECT room_id FROM game_info WHERE province_id = ?', [province_id], function(error2, province_rooms) {
                                                                                        if (error2) {
                                                                                            console.error('Error in Choosing group with same province_id');
                                                                                            return res.redirect('/game');
                                                                                        } else {
                                                                                            // 같은 province에 속한 모든 방의 사용자들에게 상태 알림
                                                                                            province_rooms.forEach(room => {
                                                                                                db.query('SELECT id FROM users WHERE room=?', [room.room_id], function(err3, province_user_lists) {
                                                                                                    if (err3) {
                                                                                                        console.error('Error updating wait_other for users in room:', room.room_id, err3);
                                                                                                    } else {
                                                                                                        province_user_lists.forEach(user => {
                                                                                                            io.message(io.user_2_socket_id[user.id], 'reload_as_status_change', ''); // 상태 변경 알림
                                                                                                        });
                                                                                                    }
                                                                                                });
                                                                                            });

                                                                                            // 동일한 province에서 아직 완료되지 않은 방이 있는지 확인
                                                                                            db.query('SELECT COUNT(*) AS incomplete FROM game_info WHERE province_id=? AND room_submit = 0', [province_id], function(err6, result6) {
                                                                                                if (err6) {
                                                                                                    console.error('Error checking group completion:', err6);
                                                                                                    return res.redirect('/game');
                                                                                                } else {
                                                                                                    if (result6[0].incomplete === 0) {
                                                                                                        // province 내 모든 방의 room_id 가져오기
                                                                                                        db.query('SELECT room_id FROM game_info WHERE province_id=?', [province_id], function(err7, province_rooms) {
                                                                                                            if (err7) {
                                                                                                                console.error('Error getting province rooms:', err7);
                                                                                                                return res.redirect('/game');
                                                                                                            } else {
                                                                                                                // 각 방의 라운드를 업데이트하고 게임 상태를 변경
                                                                                                                province_rooms.forEach(room => {
                                                                                                                    game_control.cal_round(room.room_id, round, round + 1, user_submit_list, io); // 다음 라운드로 진행
                                                                                                                    io.message(io.user_2_socket_id[user_submit_list.id], 'reload_as_status_change', ''); // 상태 변경 알림
                                                                                                                });

                                                                                                                // 모든 방의 room_submit 상태를 0으로 리셋
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
                                                                                                        // 모든 그룹이 완료되지 않았을 경우 리다이렉트
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
                                                                    // 다른 라운드일 경우 바로 다음 라운드로 진행
                                                                    game_control.cal_round(room_number, round, round + 1, user_submit_list, io);
                                                                    return res.redirect('/game');
                                                                }
                                                            } else {
                                                                // 모든 사용자가 제출하지 않았을 경우 리다이렉트
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
