var socket = io();

var admin_socket = (function() {

    var connect_user = function(user_id) {
        socket.emit('user_connected', user_id);
    }

    // public attribute, method
    return {
        connect_user: connect_user
    };
    
}());

// 중복 로그인 처리
socket.on('duplicate_login', function(msg) {
    alert("Duplicate login, ask administrator: " + msg);
    document.location.href = "/session_destroy_as_duplicate";
});

// 사용자 상태 변경 처리
socket.on('change_user_status', function(data) {
    if (data.status === '1')
        $('#status'+data.user_id).text('wait');
    else if (data.status === '2')
        $('#status'+data.user_id).text('ready');
    else if (data.status === '3')
        $('#status'+data.user_id).text('start');
    else if (data.status === '5')
        $('#status'+data.user_id).text('end');
});

// 방 라운드 변경 처리
socket.on('change_room_round', function(data) {
    $('#round'+data.room_number).text(data.round);
    if (data.round == 'end')
        $('#stop'+data.room_number).prop('disabled', true);
});

// 모든 그룹이 완료된 경우 처리
socket.on('all_groups_completed', function(data) {
    alert('All groups in Province ' + data.province_id + ' have completed the round.');
    // 추가적인 로직을 이곳에 구현할 수 있습니다.
});

// 상태 변경에 따른 새로고침 처리
socket.on('reload_as_status_change', function() {
    window.location.reload();  // 페이지 새로고침
});