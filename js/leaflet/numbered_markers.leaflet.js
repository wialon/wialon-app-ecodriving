L.NumberedDivIcon = L.Icon.extend({
	options: {
		iconUrl: 'images/marker-icon.png',
		number: '',
		iconSize: new L.Point(25, 41),
		iconAnchor: new L.Point(13, 41),
		popupAnchor: new L.Point(0, -33),
		className: 'leaflet-div-icon',
		shadowUrl: './img/markers/marker-shadow.png',
		shadowSize:  [41, 41]
	},
 
	createIcon: function () {
		var div = document.createElement('div');
		var img = this._createImg(this.options['iconUrl']);
		var numdiv = document.createElement('div');
		numdiv.setAttribute ( "class", "number" );
		numdiv.innerHTML = this.options['number'] || '';
		div.appendChild ( img );
		div.appendChild ( numdiv );
		this._setIconStyles(div, 'icon');
		return div;
	}
});