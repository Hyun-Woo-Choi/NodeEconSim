var db = require('./mysql_');
var _ = require('lodash');
const { check } = require('express-validator');

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

    async function room_time_out(room_number, round, io) {
        console.log(`room_time_out called for room: ${room_number}, round: ${round}`);
        
        const user_round = Number(round) - 1;
        const admin_round = round;
    
        try {
            // Fetch user submit list and identify users to insert
            const { user_submit_list, users_to_insert } = await fetchUserSubmitList(room_number);
            
            if (users_to_insert.length === 0) {
                console.log(`No users to insert, calling cal_round directly for room: ${room_number}`);
                await cal_round(room_number, user_round, admin_round, user_submit_list, io);
            } else {
                console.log(`Inserting missing users for room: ${room_number}`);
                await insertMissingUsers(users_to_insert, user_round, room_number);
    
                console.log(`All inserts finished for room: ${room_number}, calling cal_round`);
                await cal_round(room_number, user_round, admin_round, user_submit_list, io);
            }
        } catch (err) {
            console.error('room_time_out error:', err);
        }
    }

    async function fetchUserSubmitList(room_number) {
        try {
            const [user_submit_list] = await db.query('SELECT id, wait_other FROM users WHERE room=?', [room_number]);
            const users_to_insert = user_submit_list.filter(user => user.wait_other === 0);
            console.log(`User submit list: ${JSON.stringify(user_submit_list)}`);
            console.log(`Number of users who did not submit: ${users_to_insert.length}`);
            return { user_submit_list, users_to_insert };
        } catch (err) {
            console.error('Error fetching user submit list:', err);
            throw err;
        }
    }
    
    async function insertMissingUsers(users_to_insert, user_round, room_number) {
        const insertPromises = users_to_insert.map(async (user) => {
            try {
                await db.query(
                    'INSERT INTO game_record (round, id, room_id, start_time, input_one, input_two) VALUES(?, ?, ?, ?, 0, 0)',
                    [user_round, user.id, room_number, Date.now()]
                );
                console.log(`Insert finished for user: ${user.id}`);
            } catch (err3) {
                if (err3.code === 'ER_DUP_ENTRY') {
                    console.warn('Duplicate entry detected, ignoring insert for user:', user.id);
                } else {
                    console.error('Error inserting missing user:', err3);
                }
            }
        });
    
        await Promise.all(insertPromises);
    }
    
    // Round processing function, called after the round ends
    const cal_round = async function (room_number, user_round, admin_round, user_submit_list, io) {
        stop_room_timer(room_number); // Stop the timer
    
        // Notify the admin about the round change
        io.message(io.user_2_socket_id['admin'], 'change_room_round', { 
            round: admin_round,
            room_number: room_number
        });
    
        try {
            // Fetch game parameters
            const [parameters] = await db.query('SELECT * FROM game_parameter WHERE room_id=?', [room_number]);
    
            // Fetch previous game records
            const [prev_game_record] = await db.query("SELECT id, price_one, budget FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [user_round - 1, room_number]);
    
            // Fetch current game records
            const [record_info] = await db.query("SELECT id, input_one, input_two, round FROM game_record WHERE round=? AND room_id=? AND id!='admin'", [user_round, room_number]);
            
            // Fetch current game type
            const [userGameType] = await db.query('SELECT game_type FROM game_info WHERE room_id=?', [room_number]);

    
            // Determine which round function to call
            const essContributionRounds = [6, 19, 26];
            const communitySatisfactionRounds = [13, 20, 27];
            const mainGameRounds = [7, 8, 9, 10, 11];
            
            if (user_round < 6) { 
                await processNormalGame(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
            } else if (essContributionRounds.includes(user_round)) { 
                await processEnergyContribution(record_info, prev_game_record, userGameType, parameters, room_number, user_round, admin_round, user_submit_list, io);
            } else if (user_round ==  12) { 
                await selectDisasterRounds(parameters, room_number); 
                await processEnergyContribution(record_info, prev_game_record, userGameType, parameters, room_number, user_round, admin_round, user_submit_list, io);
            } else if (mainGameRounds.includes(user_round)) {  
                await processNormalGame(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
            } else if (communitySatisfactionRounds.includes(user_round)) { 
                await processNewBudget(record_info, prev_game_record, room_number, user_round, admin_round, user_submit_list, io);
            } else { 
                await processdisaster(record_info, prev_game_record, userGameType, parameters, room_number, user_round, admin_round, user_submit_list, io);
            }
        } catch (err) {
            console.error('Error in cal_round:', err);
        }
    };

    // Function to select disaster rounds based on the specified number
    async function selectDisasterRounds(parameters, room_number) {
        const maxDisasters = 5;
        const disasterRounds = [15, 16, 17, 18, 22, 23, 24, 25, 29, 30, 31, 32];
        const selectedDisasters = [];

        // Limit the number of disasters to the specified maximum
        const disasterCount = Math.min(parameters[0].disaster_number, maxDisasters);

        // Select unique disaster rounds
        for (let i = 0; i < disasterCount; i++) {
            const randomIndex = Math.floor(Math.random() * disasterRounds.length);
            selectedDisasters.push(disasterRounds[randomIndex]);
            disasterRounds.splice(randomIndex, 1); // Remove selected round to prevent duplication
        }

        // Sort the selected disasters for consistency
        selectedDisasters.sort((a, b) => a - b);

        // Assign selected rounds to variables
        const [first, second, third, forth, fifth] = selectedDisasters;

        try {
            // Update the game_parameter with the selected disaster rounds
            await db.query(
                'UPDATE game_parameter SET first_disaster=?, second_disaster=?, third_disaster=?, forth_disaster=?, fifth_disaster=? WHERE room_id=?',
                [first || 0, second || 0, third || 0, forth || 0, fifth || 0, room_number]
            );
            console.log('game_parameter updated successfully');
        } catch (error) {
            console.error('Error updating game_parameter:', error);
        }

        return { first, second, third, forth, fifth };
    }

    // normla 게임
    async function processNormalGame(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io) { 
        // 각 사용자의 input_one 값을 모두 더해 total_one 계산
        var total_one = record_info.reduce((acc, curr) => acc + curr.input_one, 0);
        // price_one은 total_one에서 최소값 0으로 설정 (0보다 작을 수 없도록 설정)
        var price_one = Math.max(0, total_one); // P = sum of input_one, 0은 넘을 수 없음

        // 모든 기록 처리가 끝난 후 호출될 finished 콜백을 비동기 처리로 변경
        const finished = _.after(record_info.length, async function () {
            await add_admin(admin_round, room_number, user_submit_list, io); // admin 업데이트
        });

        const firstround_with_no_record = new Set([1, 7]);

        const firstRounds = new Set([1, 7, 14, 21, 28]);

        // record_info 배열의 각 사용자에 대해 게임 기록을 비동기적으로 업데이트
        for (const record of record_info) {
            // profit은 (가격 변수 * input_one) - (price_one * input_one)으로 계산
            var cur_round_profit = (parameters[0].price_var * record.input_one) - (price_one * record.input_one);
            var cur_budget, cur_psum;
            var prev_record = prev_game_record.find(r => r.id === record.id);

            // 만약 user_round가 firstRounds일 경우 이전 데이터가 없으므로 초기 예산에서 계산
            if (firstround_with_no_record.has(user_round)) {  
                cur_budget = parameters[0].init_budget + cur_round_profit; // 초기 예산에서 이익을 더해 예산 계산
                cur_psum = cur_budget - parameters[0].init_budget; // 초기 예산과 현재 예산의 차이 계산
            } else if (firstRounds.has(user_round)) {
                // 이전 라운드의 예산과 현재 라운드의 이익을 더해 새로운 예산 계산
                cur_budget = prev_record.budget + parameters[0].init_budget + cur_round_profit;
                cur_psum = cur_budget - prev_record.budget; // 예산 차이 계산
            } else {
                // 이전 라운드의 예산과 현재 라운드의 이익을 더해 새로운 예산 계산
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

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////// ESS 라운드 
    // Main function for processing energy contributions based on game type

    async function processEnergyContribution(recordInfo, prevGameRecord, userGameType, parameters, roomNumber, userRound, adminRound, userSubmitList, io) {
        try {
            const sumEnergy = recordInfo.reduce((acc, curr) => acc + curr.input_one, 0);
            let usableEnergy, adjustmentFn;

            const province_id = parameters[0].province_id

            // Set type-specific variables
            switch (userGameType[0].game_type) {
                case 1:
                    usableEnergy = sumEnergy > 0 ? (sumEnergy / 5) / 4 : 0;
                    adjustmentFn = record => record.input_one;
                    break;
                case 2:
                    usableEnergy = sumEnergy > 0 ? (sumEnergy / 4) : 0;
                    adjustmentFn = () => (sumEnergy / 4) * 1.25;
                    break;
                case 3:
                    usableEnergy = sumEnergy > 0 ? (sumEnergy / 5) / 4 : 0;
                    adjustmentFn = record => record.input_one;
                    break;
                default:
                    console.log("Invalid game type");
                    return;
            }

            // Update game parameters and insert total energy record
            await updateGameParameter(usableEnergy, roomNumber);
            await insertTotalEnergyRecord(userRound, roomNumber, sumEnergy, province_id);

            // Process each record
            await processRecords(recordInfo, prevGameRecord, sumEnergy, usableEnergy, userRound, roomNumber, adminRound, userSubmitList, io, adjustmentFn, userGameType[0].game_type);
        } catch (paramErr) {
            console.log('Error in processEnergyContribution:', paramErr);
        }
    }

    // Helper function to update game parameters with total energy
    async function updateGameParameter(totalEnergy, roomNumber) {
        await db.query('UPDATE game_parameter SET total_energy=? WHERE room_id=?', [totalEnergy, roomNumber]);
    }

    // Helper function to insert total energy record
    async function insertTotalEnergyRecord(userRound, roomNumber, sumEnergy, province_id) {
        await db.query("INSERT INTO total_energy_record (round, province_id, room_id, total_energy) VALUES(?, ?, ?, ?)", 
                    [userRound, province_id, roomNumber, sumEnergy]);
    }

    // Helper function to process records based on adjustment logic
    async function processRecords(recordInfo, prevGameRecord, sumEnergy, usableEnergy, userRound, roomNumber, adminRound, userSubmitList, io, adjustmentFn, gameType) {
        const finished = _.after(recordInfo.length, async () => {
            await add_admin(adminRound, roomNumber, userSubmitList, io);
        }); 

        for (const record of recordInfo) {
            const prevRecord = prevGameRecord.find(r => r.id === record.id);
            const adjustment = adjustmentFn(record);
            const contributionDividends = gameType === 3 && sumEnergy > 0 
                ? 15 * (sumEnergy / 37.5) * (record.input_one / sumEnergy)
                : 0;

            try {
                await budgetUpdateFn(record, prevRecord, adjustment, contributionDividends, sumEnergy, userRound, roomNumber);
                finished();
            } catch (err) {
                console.log('Error updating game record:', err);
            }
        }
    }

    // Function to update budget based on calculations
    async function budgetUpdateFn(record, prevRecord, adjustment, contributionDividends, sumEnergy, userRound, roomNumber) {
        const budgetUpdateQuery = 'UPDATE game_record SET budget=?, contribution_profit=?, total_one=? WHERE id=? AND round=? AND room_id=?';
        const updateValues = [
            prevRecord.budget - adjustment,
            contributionDividends,
            sumEnergy,
            record.id,
            userRound,
            roomNumber
        ];
        await db.query(budgetUpdateQuery, updateValues);
    }
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

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


    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // 재난이 일어날 라운드면 processdisasterround로, 그렇지 않으면 그냥 processnormalround로

    async function processdisaster(record_info, prev_game_record, userGameType, parameters, room_number, user_round, admin_round, user_submit_list, io){
        try {
            // Check if the current round is a disaster round
            const isDisasterRound = await checkDisasterRound(parameters, room_number, user_round);

            if (isDisasterRound) {
                // If it's a disaster round, call processDisasterRound
                await processDisasterRound(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
            } else {
                // If it's not a disaster round, call processNormalGame
                await processNormalGame(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io);
            }
        } catch (error) {
            console.error("Error in processGameRound function:", error);
        }
    }

    async function checkDisasterRound(parameters, roomNumber, userRound) { // disaster round인지 확인
        try {
            // Check if the next round is a disaster round
            const disasterRounds = [
                parameters[0].first_disaster - 1,
                parameters[0].second_disaster - 1,
                parameters[0].third_disaster - 1,
                parameters[0].fourth_disaster - 1,
                parameters[0].fifth_disaster - 1
            ];
            const isDisasterRound = disasterRounds.includes(userRound) ? 1 : 0;
    
            // Update disaster occurrence status in the game_parameter table
            await db.query('UPDATE game_parameter SET isdisasteroccured = ? WHERE room_id = ?', [isDisasterRound, roomNumber]);
            
            // Return the result to use in calling function if needed
            return isDisasterRound;
    
        } catch (error) {
            console.error("Error in checkDisasterRound function:", error);
            throw error;  // Re-throw the error to handle it in the calling function if needed
        }
    }

    async function processDisasterRound(record_info, prev_game_record, parameters, room_number, user_round, admin_round, user_submit_list, io) {
        try {
            const total_one = record_info.reduce((acc, curr) => acc + curr.input_one, 0);

            // 모든 작업이 완료되면 호출될 finished 콜백 설정
            const finished = _.after(record_info.length, async function () {
                await add_admin(admin_round, room_number, user_submit_list, io); // admin 업데이트
            });

            // 각 사용자의 기록을 비동기적으로 업데이트
            for (const record of record_info) {
                const prev_record = prev_game_record.find(r => r.id === record.id);
                let cur_round_profit;

                // game_type이 3인 경우, 재난 기여를 고려한 수익 계산
                if (record_info[0].game_type == 3) {
                    cur_round_profit = ((parameters[0].price_var * record.input_one) - (parameters[0].adjusted_w * record.input_one)) + community_game_record.contribution_profit;
                } else {
                    // 일반적인 수익 계산 (가격 변동 * input_one)
                    cur_round_profit = (parameters[0].price_var * record.input_one) - (parameters[0].adjusted_w * record.input_one);
                }
            
                // 현재 라운드 예산 계산 (이전 예산 + 수익)
                const cur_budget = prev_record.budget + cur_round_profit;
                // 이전 예산과의 차이 계산
                const cur_psum = cur_budget - prev_record.budget;

                try {
                    // game_record 테이블 업데이트 (총 에너지, 가격, 이익, 예산, 재난 발생 여부)
                    await db.query(
                        'UPDATE game_record SET total_one=?, price_one=?, profit=?, budget=?, psum=?, isdisasteroccured=? WHERE id=? AND round=? AND room_id=?',
                        [total_one, parameters[0].adjusted_w, cur_round_profit, cur_budget, cur_psum, 1 , record.id, user_round, room_number]
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


    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


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
    //////admin functions

    // 관리자의 게임 기록 추가 및 다음 단계 진행
    async function add_admin(admin_round, room_number, user_submit_list, io) {
        try {
            await insertAdminGameRecord(admin_round, room_number);
            if ([13, 20, 27].includes(admin_round)) {
                await updateWaitOtherForProvince(room_number, admin_round, user_submit_list, io);
            } else {
                await updateWaitOtherForUsers(user_submit_list, io);
                await proceedToNextStep(admin_round, room_number, user_submit_list, io);
            }
        } catch (error) {
            console.error('Error in add_admin:', error);
        }
    }

    // 다른 그룹 사용자들 확인
    async function updateWaitOtherForProvince(room_number, admin_round, user_submit_list, io) {
        try {
            const [[{ province_id }]] = await db.query('SELECT province_id FROM game_info WHERE room_id=?', [room_number]);
            const [rooms_in_province] = await db.query('SELECT room_id FROM game_info WHERE province_id=?', [province_id]);

            for (const room of rooms_in_province) {
                await db.query('UPDATE users SET wait_other=0 WHERE room=?', [room.room_id]);
                await notifyUsers(room.room_id, io);
            }

            await proceedToNextStep(admin_round, room_number, user_submit_list, io);
        } catch (error) {
            console.error('Error updating wait_other for province:', error);
        }
    }

    // 관리자의 다음 라운드 진행 또는 게임 종료 처리
    async function proceedToNextStep(admin_round, room_number, user_submit_list, io) {
        if (admin_round <= 32) {
            make_room_timer(room_number, admin_round + 1, io);
        } else {
            try {
                await db.query('UPDATE users SET status=5 WHERE room=?', [room_number]);
                user_submit_list.forEach(user => {
                    io.message(io.user_2_socket_id['admin'], 'change_user_status', { user_id: user.id, status: '5' });
                });
                io.message(io.user_2_socket_id['admin'], 'change_room_round', { round: 'end', room_number: room_number });
                await db.query('UPDATE game_info SET room_status=3 WHERE room_id=?', [room_number]);
            } catch (err) {
                console.error('Error ending game:', err);
            }
        }
    }

    // 각 사용자 상태 갱신 및 알림
    async function updateWaitOtherForUsers(user_submit_list, io) {
        for (const user of user_submit_list) {
            try {
                await db.query('UPDATE users SET wait_other=0 WHERE id=?', [user.id]);
                io.message(io.user_2_socket_id[user.id], 'reload_as_status_change', '');
            } catch (error) {
                console.error(`Error updating user ${user.id} wait_other`, error);
            }
        }
    }

    async function notifyUsers(room_id, io) {
        try {
            const [users_in_room] = await db.query('SELECT id FROM users WHERE room=?', [room_id]);
            for (const user of users_in_room) {
                io.message(io.user_2_socket_id[user.id], 'reload_as_status_change', '');
            }
        } catch (error) {
            console.error(`Error notifying users in room ${room_id}:`, error);
        }
    }

    async function insertAdminGameRecord(admin_round, room_number) {
        try {
            await db.query("INSERT INTO game_record (round, id, room_id, start_time) VALUES(?, 'admin', ?, ?)", [admin_round, room_number, Date.now()]);
        } catch (err) {
            if (err.code !== 'ER_DUP_ENTRY') console.error('Insert admin game record error:', err);
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
