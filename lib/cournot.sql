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
    `game_type` int NOT NULL,
    `user_cnt` int DEFAULT 0,
    `room_status` int DEFAULT 0,
    PRIMARY KEY (`room_id`)
);

-- game room parameter
CREATE TABLE `game_parameter` (
    `room_id` int NOT NULL,
    `init_w` float NOT NULL,
    `contri_var` float NOT NULL,
    `beef_w` float NOT NULL,
    `chicken_w` float NOT NULL,
    `beef_cost_var` float NOT NULL,
    `beef_cost_b` float NOT NULL,
    `beef_cost_c` float NOT NULL,
    `chicken_cost_var` float NOT NULL,
    `chicken_cost_b` float NOT NULL,
    `chicken_cost_c` float NOT NULL,
    `init_budget` float NOT NULL,
    `loan` float NOT NULL,
    `change_var` float NOT NULL,
    `change_weight` float NOT NULL,
    PRIMARY KEY (`room_id`)
);

-- parameter for game type 1
CREATE TABLE `parameter` (
    `init_w` float NOT NULL,
    `contri_var` float NOT NULL,
    `beef_w` float NOT NULL,
    `chicken_w` float NOT NULL,
    `beef_cost_var` float NOT NULL,
    `beef_cost_b` float NOT NULL,
    `beef_cost_c` float NOT NULL,
    `chicken_cost_var` float NOT NULL,
    `chicken_cost_b` float NOT NULL,
    `chicken_cost_c` float NOT NULL,
    `init_budget` float NOT NULL,
    `loan` float NOT NULL
);

-- default parameter of game type 1
INSERT INTO parameter (init_w, contri_var, beef_w, chicken_w, beef_cost_var, beef_cost_b, beef_cost_c, 
                        chicken_cost_var, chicken_cost_b, chicken_cost_c, init_budget, loan)
            VALUES (40, 0.002, 4, 1, 460, 6, 0, 
                    340, 0, 4, 10000, 5000);

-- parameter for game type 2
CREATE TABLE `parameter2` (
    `init_w` float NOT NULL,
    `contri_var` float NOT NULL,
    `beef_w` float NOT NULL,
    `chicken_w` float NOT NULL,
    `beef_cost_var` float NOT NULL,
    `beef_cost_b` float NOT NULL,
    `beef_cost_c` float NOT NULL,
    `chicken_cost_var` float NOT NULL,
    `chicken_cost_b` float NOT NULL,
    `chicken_cost_c` float NOT NULL,
    `init_budget` float NOT NULL,
    `loan` float NOT NULL,
    `change_var` float NOT NULL,
    `change_weight` float NOT NULL
);

-- default parameter of game type 2
INSERT INTO parameter2 (init_w, contri_var, beef_w, chicken_w, beef_cost_var, beef_cost_b, beef_cost_c, 
                        chicken_cost_var, chicken_cost_b, chicken_cost_c, init_budget, loan, change_var, change_weight)
            VALUES (40, 20000, 4, 1, 460, 6, 0, 
                    340, 0, 4, 10000, 5000, 971, 0.77);

-- all game record
CREATE TABLE `game_record` (
    `round` int NOT NULL,
    `id` char(32) NOT NULL,
    `room_id` int NOT NULL,
    `start_time` bigint NOT NULL,
    `input_one` float,
    `input_two` float,
    `total_one` float DEFAULT 0,
    `total_two` float DEFAULT 0,
    `price_one` float,
    `price_two` float,
    `profit` float DEFAULT 0,
    `budget` float DEFAULT 0,
    `psum` float DEFAULT 0,
    PRIMARY KEY (`round`, `id`, `room_id`)
);