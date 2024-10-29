var db = require('./mysql_');
var _ = require('lodash');

var game_control = (function () {
    var room_timer = {};

    // 특정 방과 라운드에 대한 타이머를 설정하는 함수. 타이머는 122초(120초 + 2초 지연)
    var make_room_timer = function (room_number, round, io) {
        room_timer[room_number] = setTimeout(() => {
            room_time_out(room_number, round, io);
        }, 122 * 1000); // 122초 지연
    };

    // 특정 방의 타이머를 중지하는 함수
    var stop_room_timer = function (room_number) {
        clearTimeout(room_timer[room_number]);
    };

    // 타임아웃이 발생한 경우 0을 입력으로 처리하는 함수
    async function room_time_out(room_number, round, io) {
        console.log(`room_time_out called for room: ${room_number}, round: ${round}`);
        
        var user_round = Number(round) - 1;
        var admin_round = round;

        try {
            const [user_submit_list] = await db.query('SELECT id, wait_other FROM users WHERE room=?', [room_number]);
            console.log(`User submit list: ${JSON.stringify(user_submit_list)}`);
        
            const users_to_insert = user_submit_list.filter(user => user.wait_other === 0);
            const insert_cnt = users_to_insert.length;
            console.log(`Number of users who did not submit: ${insert_cnt}`);
        
            if (insert_cnt === 0) {
                console.log(`No users to insert, calling cal_round directly for room: ${room_number}`);
                await cal_round(room_number, user_round, admin_round, user_submit_list, io);
                
            } else {
                const finished = _.after(insert_cnt, async () => {
                    console.log(`All inserts finished for room: ${room_number}, calling cal_round`);
                    await cal_round(room_number, user_round, admin_round, user_submit_list, io);
                });

                for (const user of users_to_insert) {
                    try {
                        await db.query(
                            'INSERT INTO game_record (round, id, room_id, start_time, input_one, input_two) VALUES(?, ?, ?, ?, 0, 0)',
                            [user_round, user.id, room_number, Date.now()]
                        );
                        console.log(`Insert finished for user: ${user.id}, calling finished callback`);
                    } catch (err3) {
                        if (err3.code === 'ER_DUP_ENTRY') {
                            console.warn('room insert same time, ignoring 0 insert for room:', room_number);
                        } else {
                            console.error('during game, user insert error:', err3);
                        }
                    }
                    finished();
                }
            }
        } catch (err) {
            console.error('room time out error:', err);
        }
    }


// 라운드 처리 함수, 라운드가 끝난 후 호출됨
const cal_round = async function (room_number, user_round, admin_round, user_submit_list, io) {
    stop_room_timer(room_number); // Stop the timer

    // Notify the admin about the round change
    io.message(io.user_2_socket_id['admin'], 'change_room_round', { 
        round: admin_round,
        room_number: room_number
    });

    // Calculate the previous round
    const user_prev_round = (user_round === 14 || user_round === 21 || user_round === 28) ? user_round - 2 : user_round - 1;
    let community_round;

    // Determine community round
    if (user_round > 7 && user_round < 19) {
        community_round = 12; 
    } else if (user_round > 19 && user_round < 26) {
        community_round = 19; 
    } else if (user_round > 26) {
        community_round = 26; 
    }

    try {
        // Fetch game parameters
        const [parameters] = await db.query('SELECT * FROM game_parameter WHERE room_id=?', [room_number]);

        // Fetch previous game records
        const [prev_game_record] = await db.query("SELECT id, price_one, budget FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [user_prev_round, room_number]);

        // Fetch current game records
        const [record_info] = await db.query("SELECT id, input_one, input_two, round FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [user_round, room_number]);

        // Fetch province_id (to select groups with the same province_id)
        const [province_id] = await db.query("SELECT province_id FROM game_info WHERE room_id = ?", [room_number]);

        // Update game_parameter with province_id
        await db.query("UPDATE game_parameter SET province_id = ? WHERE room_id = ?", [province_id[0].province_id, room_number]);

        // Handle round logic and call respective function based on the round
        if (user_round < 6) { // Practice game
            await processNormalGame(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
        } else if (user_round === 6) { // ESS contribution
            await processEnergyContribution(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
        } else if (user_round >= 7 && user_round <= 11) {  // Main game, electricity production
            await processNormalGame(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
        } else if (user_round === 12) { // Disaster round and ESS contribution
            await processEnergyContribution_disaster_choice(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
        } else if (user_round === 19 || user_round === 26) { // ESS contribution
            await processEnergyContribution(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
        } else if (user_round === 13 || user_round === 20 || user_round === 27) { // Community satisfaction survey
            await processNewBudget(record_info, prev_game_record, room_number, user_round, admin_round, user_submit_list, io);
        } else { // Electricity purchase with disaster risk
            await processDisasterRound(record_info, prev_game_record, parameters, community_round, room_number, user_round, admin_round, user_submit_list, io);
        }
    } catch (err) {
        console.error('Error in cal_round:', err);
    }
};

async function processNormalGame(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io) { 
    // 각 사용자의 input_one 값을 모두 더해 total_one 계산
    var total_one = record_info.reduce((acc, curr) => acc + curr.input_one, 0);
    // price_one은 total_one에서 최소값 0으로 설정 (0보다 작을 수 없도록 설정)
    var price_one = Math.max(0, total_one); // P = sum of input_one, 0은 넘을 수 없음

    // 모든 기록 처리가 끝난 후 호출될 finished 콜백을 비동기 처리로 변경
    const finished = _.after(record_info.length, async function () {
        await add_admin(admin_round, room_number, user_submit_list, io); // admin 업데이트
    });

    // record_info 배열의 각 사용자에 대해 게임 기록을 비동기적으로 업데이트
    for (const record of record_info) {
        // profit은 (가격 변수 * input_one) - (price_one * input_one)으로 계산
        var cur_round_profit = (parameters[0].price_var * record.input_one) - (price_one * record.input_one);
        var cur_budget, cur_psum;

        // 만약 user_round가 1 또는 8일 경우 이전 데이터가 없으므로 초기 예산에서 계산
        if (user_round == 1 || user_round == 8) { 
            cur_budget = parameters[0].init_budget + cur_round_profit; // 초기 예산에서 이익을 더해 예산 계산
            cur_psum = cur_budget - parameters[0].init_budget; // 초기 예산과 현재 예산의 차이 계산
        } else {
            // 이전 라운드의 예산과 현재 라운드의 이익을 더해 새로운 예산 계산
            var prev_record = prev_game_record.find(r => r.id === record.id);
            cur_budget = prev_record.budget + cur_round_profit;
            cur_psum = cur_budget - prev_record.budget; // 예산 차이 계산
        }

        var cur_id = record.id; // 현재 사용자 ID

        try {
            // game_record 테이블에서 해당 사용자의 기록을 업데이트
            await db.query('UPDATE game_record SET total_one=?, price_one=?, profit=?, budget=?, psum=? WHERE id=? AND round=? AND room_id=?',
                [total_one, price_one, cur_round_profit, cur_budget, cur_psum, cur_id, user_round, room_number]);

            // 각 업데이트가 완료될 때마다 finished 호출
            finished();
        } catch (err7) {
            console.log('update param error:', err7); // 오류 발생 시 로그 출력
        }
    }
}
    


async function processEnergyContribution_disaster_choice(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io) {
    // 재난 라운드의 최대 개수를 5로 제한 (최대 5번의 재난 라운드를 선택)
    if (parameters[0].disaster_number > 5) {
        parameters[0].disaster_number = 5;
    }

    // 재난 라운드로 선택될 수 있는 라운드 목록 (15, 16, 17, 18, 22, 23, 24, 25, 29, 30, 31, 32)
    const disaster_rounds = [15, 16, 17, 18, 22, 23, 24, 25, 29, 30, 31, 32];
    const selected_disasters = []; // 선택된 재난 라운드를 저장할 배열
    
    // 재난 수에 맞게 재난 라운드를 선택 (겹치지 않도록 처리)
    for (let i = 0; i < parameters[0].disaster_number; i++) {
        const randomIndex = Math.floor(Math.random() * disaster_rounds.length);
        selected_disasters.push(disaster_rounds[randomIndex]); // 선택된 라운드를 추가
        disaster_rounds.splice(randomIndex, 1); // 중복 선택 방지를 위해 해당 라운드를 배열에서 제거
    }

    // 선택된 재난 라운드를 오름차순으로 정렬
    selected_disasters.sort((a, b) => a - b);
    
    // 선택된 재난 라운드를 각 변수에 할당 (최대 5개)
    const [first_round_disaster, second_round_disaster, third_round_disaster, forth_round_disaster, fifth_round_disaster] = selected_disasters;

    // 총 에너지를 계산 (각 사용자의 input_one 값을 모두 더함)
    const sum_energy = record_info.reduce((acc, curr) => acc + curr.input_one, 0);
    
    // sum_energy가 0인 경우 total_energy는 0, 그렇지 않으면 128로 나눈 값
    const total_energy = sum_energy > 0 ? sum_energy / 128 : 0;

    try {
        // 게임 파라미터를 업데이트 (선택된 재난 라운드와 총 에너지)
        await db.query(
            'UPDATE game_parameter SET total_energy=?, first_disaster=?, second_disaster=?, third_disaster=?, forth_disaster=?, fifth_disaster=? WHERE room_id=?',
            [total_energy, first_round_disaster || 0, second_round_disaster || 0, third_round_disaster || 0, forth_round_disaster || 0, fifth_round_disaster || 0, room_number]
        );

        // 모든 작업이 완료되면 호출될 finished 콜백 설정
        const finished = _.after(record_info.length, async function () {
            await add_admin(admin_round, room_number, user_submit_list, io); // admin 업데이트
        });

        // 각 사용자에 대한 기록을 비동기적으로 업데이트
        for (const record of record_info) {
            const contribution_dividends = sum_energy > 0 
                ? 15 * (sum_energy / 37.5) * (record.input_one / sum_energy)
                : 0;

            try {
                // 게임 정보에서 game_type과 province_id를 가져옴
                const [user_game_type] = await db.query('SELECT game_type, province_id FROM game_info WHERE room_id=?', [room_number]);
                const province_id = user_game_type[0].province_id;

                // 총 에너지 기록을 total_energy_record 테이블에 삽입
                await db.query(
                    "INSERT INTO total_energy_record (round, province_id, room_id, total_energy) VALUES(?, ?, ?, ?)", 
                    [user_round, province_id, room_number, sum_energy]
                );

                // 예산 업데이트 함수 정의
                const budget_update_fn = async function (record, prev_record, adjustment, contribution_dividends) {
                    // 게임 기록을 업데이트 (예산, 기여 이익, 총 에너지)
                    try {
                        await db.query(
                            'UPDATE game_record SET budget=?, contribution_profit=?, total_one=? WHERE id=? AND round=? AND room_id=?',
                            [prev_record.budget - adjustment, contribution_dividends, sum_energy, record.id, user_round, room_number]
                        );
                        finished();
                    } catch (err7) {
                        console.log('update budget error:', err7); // 예산 업데이트 시 오류 발생
                    }
                };

                // 이전 라운드 기록에서 현재 사용자의 기록을 찾음
                const prev_record = prev_game_record.find(r => r.id === record.id);
                if (user_game_type[0].game_type === 1) {
                    await budget_update_fn(record, prev_record, record.input_one, contribution_dividends);
                } else if (user_game_type[0].game_type === 2) {
                    const type_2_community_fund = sum_energy > 0 
                        ? Math.round(((sum_energy / 4) * 128) / 4)
                        : 0;
                    await budget_update_fn(record, prev_record, type_2_community_fund, contribution_dividends);
                } else {
                    await budget_update_fn(record, prev_record, record.input_one, contribution_dividends);
                }
            } catch (err) {
                console.log('Error updating game record:', err);
            }
        }
    } catch (err) {
        console.log('Error updating game_parameter:', err);
    }
}

async function processEnergyContribution(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io) {
    // 총 에너지를 계산 (각 사용자의 input_one 값을 모두 더함)
    var sum_energy = record_info.reduce((acc, curr) => acc + curr.input_one, 0);

    // sum_energy가 0이면 total_energy는 0, 아니면 정상적으로 나누기 연산
    var total_energy = sum_energy > 0 ? (sum_energy / 35) : 0;

    try {
        // 게임 파라미터에 총 에너지 업데이트
        await db.query('UPDATE game_parameter SET total_energy=? WHERE room_id=?', [total_energy, room_number]);

        // 모든 작업이 완료되면 호출될 finished 콜백 설정
        const finished = _.after(record_info.length, async function () {
            await add_admin(admin_round, room_number, user_submit_list, io);
        });

        // 각 사용자에 대한 기록을 비동기적으로 업데이트
        for (const record of record_info) {
            const contribution_dividends = sum_energy > 0 
                ? 15 * (sum_energy / 37.5) * (record.input_one / sum_energy)
                : 0;

            try {
                // 게임 정보에서 game_type과 province_id를 가져옴
                const [user_game_type] = await db.query('SELECT game_type, province_id FROM game_info WHERE room_id=?', [room_number]);
                const province_id = user_game_type[0].province_id;

                // 총 에너지 기록을 total_energy_record 테이블에 삽입
                await db.query("INSERT INTO total_energy_record (round, province_id, room_id, total_energy) VALUES(?, ?, ?, ?)", 
                    [user_round, province_id, room_number, sum_energy]);

                // 예산 업데이트 함수 정의
                const budget_update_fn = async function (record, prev_record, adjustment, contribution_dividends) {
                    try {
                        await db.query(
                            'UPDATE game_record SET budget=?, contribution_profit=?, total_one=? WHERE id=? AND round=? AND room_id=?',
                            [prev_record.budget - adjustment, contribution_dividends, sum_energy, record.id, user_round, room_number]
                        );
                        finished();
                    } catch (err7) {
                        console.log('update budget error:', err7); // 예산 업데이트 시 오류 발생
                    }
                };

                // 이전 라운드 기록에서 현재 사용자의 기록을 찾음
                const prev_record = prev_game_record.find(r => r.id === record.id);
                
                if (user_game_type[0].game_type === 1) {
                    // game_type이 1인 경우, input_one을 기반으로 예산 업데이트
                    await budget_update_fn(record, prev_record, record.input_one, contribution_dividends);
                } else if (user_game_type[0].game_type === 2) {
                    // game_type이 2인 경우, 커뮤니티 펀드 기반으로 예산 업데이트
                    const type_2_community_fund = sum_energy > 0 
                        ? Math.round(((sum_energy / 4) * 35) / 4) 
                        : 0;
                    await budget_update_fn(record, prev_record, type_2_community_fund, contribution_dividends);
                } else {
                    // 다른 game_type의 경우, input_one을 기반으로 예산 업데이트
                    await budget_update_fn(record, prev_record, record.input_one, contribution_dividends);
                }
            } catch (err) {
                console.log('Error updating game record:', err);
            }
        }
    } catch (err7) {
        console.log('update contribution error:', err7);
    }
}

/* 이건 안 쓸예정.

    function ResetBudget(record_info, parameters, room_number, user_round, admin_round, user_submit_list, io) { // budget reset 하는 로직인데, 프로그램에는 포함 안됨. 
        var finished = _.after(record_info.length, function () {
            add_admin(admin_round, room_number, user_submit_list, io);
        });
    
        record_info.forEach((record, index) => {    
            var cur_budget = parameters[0].init_budget
            var cur_id = record.id;

            db.query('UPDATE game_record SET budget=? WHERE id=? AND round=? AND room_id=?',
                [cur_budget, cur_id, user_round, room_number],
                function (err7) {
                    if (err7) {
                        console.log('update budget error', err7);
                    } else {
                        finished();
                    }
                }
            );
        });
    }
  
*/
    
async function processNewBudget(record_info, prev_game_record, room_number, user_round, admin_round, user_submit_list, io) {
    // 모든 작업이 완료된 후 호출될 finished 콜백을 비동기 처리로 변경
    const finished = _.after(record_info.length, async function () {
        await add_admin(admin_round, room_number, user_submit_list, io); // admin 업데이트
    });

    // 각 사용자의 기록을 순회하며 예산을 비동기적으로 업데이트
    for (const record of record_info) {
        const prev_record = prev_game_record.find(r => r.id === record.id); // 이전 라운드의 예산을 가져옴
        const cur_budget = prev_record.budget; // 이전 라운드 예산
        const cur_id = record.id; // 현재 사용자의 ID

        try {
            // game_record 테이블에서 해당 사용자의 예산(budget)을 업데이트
            await db.query('UPDATE game_record SET budget=? WHERE id=? AND round=? AND room_id=?',
                [cur_budget, cur_id, user_round, room_number]);
            
            // 각 업데이트가 완료될 때마다 finished 호출
            finished();
        } catch (err7) {
            console.log('update budget error:', err7); // 예산 업데이트 중 오류 발생 시 로그 출력
        }
    }
}

async function processDisasterRound(record_info, prev_game_record, parameters, community_round, room_number, user_round, admin_round, user_submit_list, io) {
    try {
        // 커뮤니티 라운드에 해당하는 게임 기록 조회 (관리자는 제외)
        const [community_game_record] = await db.query(
            "SELECT * FROM game_record WHERE round=? AND room_id=? AND id!='admin'",
            [community_round, room_number]
        );

        // 현재 방의 game_parameter 정보 조회
        const [result1] = await db.query('SELECT * FROM game_parameter WHERE room_id=?', [room_number]);

        // 다음 라운드가 재난 발생 라운드인지 확인 (맞다면 disaster_occurence를 1로 설정)
        const disaster_occurence = 
            (user_round == (result1[0].first_disaster - 1) || 
            user_round == (result1[0].second_disaster - 1) || 
            user_round == (result1[0].third_disaster - 1) || 
            user_round == (result1[0].forth_disaster - 1) || 
            user_round == (result1[0].fifth_disaster - 1)) ? 1 : 0;

        // 재난 발생 여부를 game_parameter 테이블에 업데이트
        await db.query('UPDATE game_parameter SET isdisasteroccured=? WHERE room_id=?', [disaster_occurence, room_number]);

        const isDisasterRound = (
            user_round == result1[0].first_disaster ||
            user_round == result1[0].second_disaster ||
            user_round == result1[0].third_disaster ||
            user_round == result1[0].forth_disaster ||
            user_round == result1[0].fifth_disaster
        );

        const total_one = record_info.reduce((acc, curr) => acc + curr.input_one, 0);
        const price_one = Math.max(0, total_one); // 총 에너지는 음수가 될 수 없으므로 최소 0

        // 모든 작업이 완료되면 호출될 finished 콜백 설정
        const finished = _.after(record_info.length, async function () {
            await add_admin(admin_round, room_number, user_submit_list, io); // admin 업데이트
        });

        // 각 사용자의 기록을 비동기적으로 업데이트
        for (const record of record_info) {
            const prev_record = prev_game_record.find(r => r.id === record.id);
            let cur_round_profit;

            if (isDisasterRound) {
                // game_info 테이블에서 현재 방의 game_type을 조회
                const [user_game_type] = await db.query('SELECT game_type FROM game_info WHERE room_id=?', [room_number]);

                // game_type이 3인 경우, 재난 기여를 고려한 수익 계산
                if (user_game_type[0].game_type == 3) {
                    cur_round_profit = ((price_one * record.input_one) - (result1[0].adjusted_w * record.input_one)) + community_game_record.contribution_profit;
                } else {
                    // 일반적인 수익 계산 (가격 변동 * input_one)
                    cur_round_profit = (parameters[0].price_var * record.input_one) - (price_one * record.input_one);
                }
            } else {
                // 재난이 발생하지 않는 일반 라운드 처리
                cur_round_profit = (parameters[0].price_var * record.input_one) - (price_one * record.input_one); // 수익 계산
            }

            // 현재 라운드 예산 계산 (이전 예산 + 수익)
            const cur_budget = prev_record.budget + cur_round_profit;
            // 이전 예산과의 차이 계산
            const cur_psum = cur_budget - prev_record.budget;

            try {
                // game_record 테이블 업데이트 (총 에너지, 가격, 이익, 예산, 재난 발생 여부)
                await db.query(
                    'UPDATE game_record SET total_one=?, price_one=?, profit=?, budget=?, psum=?, isdisasteroccured=? WHERE id=? AND round=? AND room_id=?',
                    [total_one, price_one, cur_round_profit, cur_budget, cur_psum, disaster_occurence, record.id, user_round, room_number]
                );
                finished();
            } catch (err) {
                console.log('Error updating game record:', err); // 업데이트 중 오류 발생 시 로그 출력
            }
        }
    } catch (err) {
        console.log('Error in processDisasterRound:', err);
    }
}


async function proceedToNextStep(admin_round, room_number, user_submit_list, io) { // 방 종료시키는 함수
    // admin_round가 32 이하인 경우, 다음 라운드를 위해 타이머를 설정
    if (admin_round <= 32) { 
        make_room_timer(room_number, admin_round + 1, io); // admin_round를 1 증가시켜 타이머를 설정
    } else if (admin_round > 32) { 
        // admin_round가 32보다 큰 경우, 게임 종료 처리
        try {
            // 모든 사용자들의 상태를 '5'로 업데이트 (게임 종료 상태)
            await db.query('UPDATE users SET status=5 WHERE room=?', [room_number]);

            // 모든 사용자에게 상태 변경 메시지를 전송
            user_submit_list.forEach(user => {
                io.message(io.user_2_socket_id['admin'], 'change_user_status', {
                    user_id: user.id,
                    status: '5'
                });
            });

            // 관리자에게 방의 라운드 종료 메시지 전송
            io.message(io.user_2_socket_id['admin'], 'change_room_round', {
                round: 'end',
                room_number: room_number
            });

            // 게임 정보에서 해당 방의 상태를 'room_status=3' (게임 종료)로 업데이트
            await db.query('UPDATE game_info SET room_status=3 WHERE room_id=?', [room_number]);
        } catch (err) {
            console.log('Error ending game:', err); // 오류 발생 시 로그 출력
        }
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


async function add_admin(admin_round, room_number, user_submit_list, io) {
    try {
      await insertAdminGameRecord(admin_round, room_number); // Insert admin record
  
      if ([13, 20, 27].includes(admin_round)) {
        await updateWaitOtherForProvince(room_number, admin_round, user_submit_list, io); // Handle all rooms in province
      } else {
        await updateWaitOtherForUsers(user_submit_list, io); // Update `wait_other` for users in `user_submit_list`
        await proceedToNextStep(admin_round, room_number, user_submit_list, io); // Proceed to next step
      }
    } catch (error) {
      console.error('Error in add_admin:', error);
    }
  }
  
  async function insertAdminGameRecord(admin_round, room_number) {
    try {
      await db.query(
        "INSERT INTO game_record (round, id, room_id, start_time) VALUES(?, 'admin', ?, ?)", 
        [admin_round, room_number, Date.now()]
      );
    } catch (err2) {
      if (err2.code === 'ER_DUP_ENTRY') {
        console.log('Ignoring duplicate entry for admin round:', admin_round);
      } else {
        console.error('Insert admin game record error:', err2);
      }
    }
  }
  
  async function updateWaitOtherForProvince(room_number, admin_round, user_submit_list, io) {
    try {
      const [[{ province_id }]] = await db.query('SELECT province_id FROM game_info WHERE room_id=?', [room_number]);
  
      const [rooms_in_province] = await db.query('SELECT room_id FROM game_info WHERE province_id=?', [province_id]);
  
      for (const room of rooms_in_province) {
        await db.query('UPDATE users SET wait_other=0 WHERE room=?', [room.room_id]);
        await notifyUsers(room.room_id, io); // Notify users in the room of status change
      }
  
      await proceedToNextStep(admin_round, room_number, user_submit_list, io);
    } catch (error) {
      console.error('Error updating wait_other for province:', error);
    }
  }
  
  async function updateWaitOtherForUsers(user_submit_list, io) {
    for (const user of user_submit_list) {
      try {
        await db.query('UPDATE users SET wait_other=0 WHERE id=?', [user.id]);
        io.message(io.user_2_socket_id[user.id], 'reload_as_status_change', ''); // Notify user of status change
      } catch (error) {
        console.error('Error updating wait_other for user:', user.id, error);
      }
    }
  }
  
  async function notifyUsers(room_id, io) {
    try {
      const [users_in_room] = await db.query('SELECT id FROM users WHERE room=?', [room_id]);
  
      for (const user of users_in_room) {
        io.message(io.user_2_socket_id[user.id], 'reload_as_status_change', ''); // Notify user of status change
      }
    } catch (error) {
      console.error('Error notifying users in room:', room_id, error);
    }
  }
  
  // Expose timer functions and round calculation
  return {
    make_room_timer: make_room_timer,
    stop_room_timer: stop_room_timer,
    cal_round: cal_round
  };
}());

module.exports = game_control;
