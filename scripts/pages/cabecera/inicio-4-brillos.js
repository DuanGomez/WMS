(function () {
  // Brillos del acceso: arrancan en pausa (los avanza el paso de 2 Hz), no a 60 fps al cambiar de pantalla.
  document.addEventListener('animationstart', function (e) {
    var t = e.target;
    if (t && t.classList && (t.classList.contains('a-glow-a') || t.classList.contains('a-glow-b'))) t.getAnimations().forEach(function (a) { a.pause(); });
  }, true);
})();
