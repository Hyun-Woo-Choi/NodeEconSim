var socket = io();

var users_socket = (function() {

    var connect_user = function(user_id) {
        socket.emit('user_connected', user_id);
    }

    // public attribute, method
    return {
        connect_user: connect_user
    };
    
}());

socket.on('duplicate_login', function(msg) {
    alert("duplicate loing, ask administrator" + msg);
    document.location.href = "/session_destroy_as_duplicate";
});

socket.on('reload_as_status_change', function(msg) {
    location.reload();
});

socket.on('other_user_submit', function(msg) {
    if ($('#other_user_status_1').hasClass('badge-danger')) {
        $('#other_user_status_1').removeClass('badge-danger');
        $('#other_user_status_1').addClass('badge-primary');
    }
    else if ($('#other_user_status_2').hasClass('badge-danger')) {
        $('#other_user_status_2').removeClass('badge-danger');
        $('#other_user_status_2').addClass('badge-primary');
    }
    else if ($('#other_user_status_3').hasClass('badge-danger')) {
        $('#other_user_status_3').removeClass('badge-danger');
        $('#other_user_status_3').addClass('badge-primary');
    }
});

socket.on('stop_user', function(msg) {
    $('#game_submit').prop('disabled',true);
    $('#game_explain').text(msg);
    $('#time_limit').css('display', 'none');
})