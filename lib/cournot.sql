CREATE DATABASE cournot;

-- users
CREATE TABLE `users` (
    `id` char(32) NOT NULL,
    `password` char(255) NOT NULL,
    `room` int NOT NULL DEFAULT 0,
    `status` int NOT NULL DEFAULT 0,
    `wait_other` TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`)
);
-- status: { 0: not in room, 1: in room, not ready, 2: room, ready, 3: on game, 4: stop game, 5: game end}

-- game room information
CREATE TABLE `game_info` (
    `room_id` int NOT NULL AUTO_INCREMENT,
    `room_submit` int NOT NULL DEFAULT 0,
    `province_id` int NOT NULL DEFAULT 0, 
    `game_type` int NOT NULL,
    `user_cnt` int DEFAULT 0,
    `room_status` int DEFAULT 0,
    PRIMARY KEY (`room_id`)
);

-- game room parameter
CREATE TABLE `game_parameter` (
    `room_id` int NOT NULL,
    `init_w` float NOT NULL,
    `adjusted_w` float NOT NULL,
    `price_var` float NOT NULL, 
    `init_budget` float NOT NULL,
    `disaster_probability` float NOT NULL,
    `isdisasteroccured` int NOT NULL DEFAULT 0,
    `first_disaster` int NOT NULL DEFAULT 0,
    `second_disaster` int NOT NULL DEFAULT 0,
    `third_disaster` int NOT NULL DEFAULT 0,
    `forth_disaster` int NOT NULL DEFAULT 0,
    `fifth_disaster` int NOT NULL DEFAULT 0,
    `total_energy` int NOT NULL DEFAULT 0,
    `disaster_number` int NOT NULL DEFAULT 0,
    `province_id` int NOT NULL DEFAULT 0,
    PRIMARY KEY (`room_id`)
);

-- parameter for game type 
CREATE TABLE `disaster_parameter` (
    `init_w` float NOT NULL,
    `adjusted_w` float NOT NULL,
    `price_var` float NOT NULL, 
    `init_budget` float NOT NULL,
    `disaster_probability` float NOT NULL,
    `isdisasteroccured` int NOT NULL DEFAULT 0,
    `first_disaster` int NOT NULL DEFAULT 0,
    `second_disaster` int NOT NULL DEFAULT 0,
    `third_disaster` int NOT NULL DEFAULT 0,
    `forth_disaster` int NOT NULL DEFAULT 0,
    `fifth_disaster` int NOT NULL DEFAULT 0,
    `total_energy` int NOT NULL DEFAULT 0,
    `disaster_number` int NOT NULL DEFAULT 0
);

-- default parameter of game
INSERT INTO disaster_parameter (init_w, adjusted_w, price_var, init_budget, disaster_probability, isdisasteroccured, first_disaster, second_disaster, third_disaster, forth_disaster, fifth_disaster, total_energy, disaster_number)
            VALUES (10, 10, 40, 5000, 20, 0, 0, 0, 0, 0, 0, 0, 0);

-- all game record
CREATE TABLE `game_record` (
    `round` int NOT NULL,
    `id` char(32) NOT NULL,
    `room_id` int NOT NULL,
    `start_time` bigint NOT NULL,
    `input_one` float,
    `input_two` float,
    `total_one` float DEFAULT 0,
    `province_id` float DEFAULT 0,
    `price_one` float,
    `contribution_profit` float DEFAULT 0,
    `profit` float DEFAULT 0,
    `budget` float DEFAULT 0,
    `psum` float DEFAULT 0,
    `disaster_probability` int DEFAULT 0,
    `isdisasteroccured` int DEFAULT 0,
    PRIMARY KEY (`round`, `id`, `room_id`)
);

-- total_energy_record
CREATE TABLE `total_energy_record` (
    `province_id` int NOT NULL,
    `round` int NOT NULL,
    `room_id` int NOT NULL,
    `total_energy` int NOT NULL,
    PRIMARY KEY (`round`, `room_id`)
);