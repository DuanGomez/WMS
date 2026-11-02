// En táctil no hay View Transitions: el fundido de toda la pantalla se dibujaba con la GPU del celular.
try{if(matchMedia('(hover: none)').matches)delete Document.prototype.startViewTransition}catch(e){}
