/*
  Reusable compact inline audio player.
*/
(function () {
  var currentAudio = null;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    var total = Math.floor(seconds);
    var minutes = Math.floor(total / 60);
    var secs = String(total % 60);
    if (secs.length < 2) secs = '0' + secs;
    return minutes + ':' + secs;
  }

  function render(options) {
    var config = options || {};
    var id = escapeHtml(config.id || ('inline-audio-' + Math.random().toString(36).slice(2)));
    var label = escapeHtml(config.label || 'Play audio');
    var src = escapeHtml(config.src || config.url || '');

    if (!src) return '';

    return (
      ' <span class="inline-audio-control" data-inline-audio-control>' +
        '<button type="button" class="inline-audio-play" data-inline-audio-toggle aria-label="' + label + '" aria-pressed="false" aria-controls="' + id + '">' +
          '<span class="icon solid fa-play" aria-hidden="true"></span>' +
        '</button>' +
        '<span class="inline-audio-panel" aria-hidden="true">' +
          '<span class="inline-audio-track" data-inline-audio-track role="progressbar" aria-label="Audio progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
            '<span class="inline-audio-progress" data-inline-audio-progress></span>' +
          '</span>' +
          '<span class="inline-audio-time" data-inline-audio-time>0:00</span>' +
        '</span>' +
        '<audio id="' + id + '" preload="metadata" src="' + src + '"></audio>' +
      '</span>'
    );
  }

  function stopCurrent() {
    if (!currentAudio) return;
    currentAudio.pause();
    currentAudio = null;
  }

  function init(scope) {
    var root = scope || document;
    var controls = root.querySelectorAll('[data-inline-audio-control]');

    controls.forEach(function (control) {
      if (control.getAttribute('data-inline-audio-ready') === 'true') return;

      var audio = control.querySelector('audio');
      var button = control.querySelector('[data-inline-audio-toggle]');
      var panel = control.querySelector('.inline-audio-panel');
      var time = control.querySelector('[data-inline-audio-time]');
      var progress = control.querySelector('[data-inline-audio-progress]');
      var track = control.querySelector('[data-inline-audio-track]');

      if (!audio || !button || !panel || !time || !progress || !track) return;
      control.setAttribute('data-inline-audio-ready', 'true');

      function setPlaying(isPlaying) {
        button.classList.toggle('is-playing', isPlaying);
        button.setAttribute('aria-pressed', isPlaying ? 'true' : 'false');
        button.innerHTML = '<span class="icon solid ' + (isPlaying ? 'fa-pause' : 'fa-play') + '" aria-hidden="true"></span>';
        panel.setAttribute('aria-hidden', isPlaying || audio.currentTime > 0 ? 'false' : 'true');
      }

      function updateProgress() {
        var duration = audio.duration || 0;
        var current = audio.currentTime || 0;
        var percent = duration ? Math.min((current / duration) * 100, 100) : 0;
        progress.style.width = percent + '%';
        track.setAttribute('aria-valuenow', Math.round(percent));
        time.textContent = formatTime(current);
      }

      audio.addEventListener('loadedmetadata', function () {
        panel.setAttribute('aria-hidden', 'false');
        time.textContent = formatTime(audio.duration || 0);
      });

      audio.addEventListener('timeupdate', updateProgress);
      audio.addEventListener('pause', function () {
        setPlaying(false);
      });
      audio.addEventListener('ended', function () {
        audio.currentTime = 0;
        updateProgress();
        setPlaying(false);
      });

      button.addEventListener('click', function () {
        if (currentAudio && currentAudio !== audio) currentAudio.pause();

        if (audio.paused) {
          currentAudio = audio;
          audio.play().then(function () {
            setPlaying(true);
            updateProgress();
          }).catch(function () {
            setPlaying(false);
          });
        } else {
          audio.pause();
        }
      });

      track.addEventListener('click', function (event) {
        if (!audio.duration) return;
        var rect = track.getBoundingClientRect();
        var ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
        audio.currentTime = audio.duration * ratio;
        updateProgress();
      });
    });
  }

  window.InlineAudioControl = {
    render: render,
    init: init,
    stopCurrent: stopCurrent
  };
})();
