/* jshint -W100 */
var LANG = "en";
var PLOT = null;
var MAP = null;
var MARKERS = [];
var MULTIPOLY = [];
// Requests query
var QUERY = [];
// Active request
var ACTIVE = null;

// Localization
var MEASURE = null;
var KM2MI = 0.6214;
var FIRST_DAY = 1;

var DATE_FORMAT = "";
var TZ = 0, DST = 0, TIMEZONE_DIFF = 0;
var TODAY = {from: 0, to: 0};

var LOCAL_STATE = {
	dragging: false,
	///
	tab_index: 0,
	/// Cache for items by type
	item_cache: {},
	///
	last_sel_tab: "",
	///
	tab_history: [],
	///
	last_flot_hover: null,
	///
	last_flot_click: null,
	///
	map_bounds: [],
	///
	criteria: [
		{"yaxis":{"from":0,"to":20},"color":"#fce6e8"},
		{"yaxis":{"from":20,"to":80},"color":"#fdf2de"},
		{"yaxis":{"from":80,"to":100},"color":"#e6f6f6"}
	],
	/// Tab colors
	colors: {"0":"",1:"#59c2bd",2:"#fcc32b",4:"#c47db7",8:"#369dca"},
	///
	color_in_use: 0,
	///
	unit_opts: {},
	///
	tabs:{},
	///
	speed_color:["#66ffff", "#0099ff", "#3300ff", "#990099", "#ff0033"],
	///
	speed_limit: [0, 40, 60, 90, 120],
	speed_limit_us: [0, 25, 40, 55, 75],
	///
	violation_types: [{
		name: "Acceleration",
		cl: "a"
	},{
		name:"Braking",
		cl: "b"
	},{
		name: "Turn",
		cl: "t"
	},{
		name: "Speeding",
		cl: "sp"
	},{
		name: "Custom",
		cl: "se"
	},{
		name: "Harsh driving",
		cl: "hd"
	}]
};

/// Global event handlers
var callbacks = {};

/** Execute callback
 *
 *  @param {int} id   callback id
 */
function exec_callback(id) {
	if (!callbacks[id])
		return null;
	callbacks[id].call();
	delete callbacks[id];
	return null;
}

/** Wrap callback function
 *
 * @param {Function} callback   function to be saved and callback later
 * @returns {int} wrapped callback id
 */
function wrap_callback(callback) {
	var id = (new Date()).getTime();
	callbacks[id] = callback;
	return id;
}

/** Load scripts
 *
 * @param {String} src   script source
 * @param {Function} callback   function to be executed after script loaded
 */
function load_script(src, callback) {
	var script = document.createElement("script");
	script.setAttribute("type", "text/javascript");
	script.setAttribute("charset", "UTF-8");
	script.setAttribute("src", src);
	if (callback && typeof callback === "function") {
		wrap_callback(callback);
		if ($.browser.msie && parseInt($.browser.version,10)<9) {
			script.onreadystatechange = function () {
				if (this.readyState === 'complete') {
					callback();
				}
			};
		} else {
			script.setAttribute("onLoad", "exec_callback(" + wrap_callback(callback) + ")");
		}
	}
	document.getElementsByTagName("head")[0].appendChild(script);
}

/** Fetch variable from 'GET' request
 *
 *  @param {String} name   param name
 *  @returns {String} param value
 */
var get_url_parameter = _.memoize(function (name) {
	if (!name)
		return null;
	var pairs = decodeURIComponent(document.location.search.substr(1)).split("&");
	for (var i = 0; i < pairs.length; ++i) {
		var pair = pairs[i].split("=");
		if (pair[0] === name) {
			pair.splice(0, 1);
			return pair.join("=");
		}
	}
	return null;
});

/** Init Wialon SDK (callback of load script wialon.js)
 */
function init_sdk() {
	var url = get_url_parameter("baseUrl");
	if (!url)
		url = get_url_parameter("hostUrl");
	if (!url)
		return;

	var user = get_url_parameter("user") || "";
	var sid = get_url_parameter("sid");
	var authHash = get_url_parameter("authHash");

	wialon.core.Session.getInstance().initSession(url);
	if (authHash) {
		wialon.core.Session.getInstance().loginAuthHash(authHash, login);
	} else if (sid) {
		wialon.core.Session.getInstance().duplicate(sid, user, true, login);
	}
}

/** Login callback
 */
function login(code) {
	if (code !== 0) {
		alert($.localise.tr("Login error"));
		return;
	}

	// set default regional settings
	var regional = $.datepicker.regional[LANG];
	if (regional) {
		$.datepicker.setDefaults(regional);
		DATE_FORMAT = rightFormat($.datepicker._defaults.dateFormat, "HH:mm:ss");
		// also wialon locale
		wialon.util.DateTime.setLocale(
			regional.dayNames,
			regional.monthNames,
			regional.dayNamesShort,
			regional.monthNamesShort
		);
	}

	wialon.core.Remote.getInstance().startBatch("initBatch");
	var user = wialon.core.Session.getInstance().getCurrUser();

	// get user locale
	user.getLocale(function(code, locale){
		if (code) {
			return;
		}

		var options = {
			template:
			'<div class="interval-wialon-container {className}" id="{id}">' +
			'   <div class="iw-select">' +
			'       <button data-period="0" type="button" class="iw-period-btn period_0">{yesterday}</button>' +
			'       <button data-period="1" type="button" class="iw-period-btn period_1">{today}</button>' +
			'       <button data-period="2" type="button" class="iw-period-btn period_2">{week}</button>' +
			'       <button data-period="3" type="button" class="iw-period-btn period_3">{month}</button>' +
			'       <button data-period="4" type="button" class="iw-period-btn period_4">{custom}</button>' +
			'   </div>' +
			'   <div class="iw-pickers">' +
			'       <input type="text" class="iw-from" /> &ndash; <input type="text" class="iw-to" />' +
			'       <button type="button" class="iw-time-btn">{ok}</button>' +
			'   </div>' +
			'   <div class="iw-labels">' +
			'       <a href="#" class="iw-similar-btn past" data-similar="past"></a>' +
			'       <a href="#" class="iw-similar-btn future" data-similar="future"></a>' +
			'       <span class="iw-label"></span>' +
			'   </div>' +
			'</div>',
			 labels: {
				yesterday: $.localise.tr("Yesterday"),
				today: $.localise.tr("Today"),
				week: $.localise.tr("Week"),
				month: $.localise.tr("Month"),
				custom: $.localise.tr("Custom"),
				ok: "OK"
			},
			tzOffset: wialon.util.DateTime.getTimezoneOffset() + wialon.util.DateTime.getDSTOffset(),
			now: wialon.core.Session.getInstance().getServerTime(),
			onChange: changeTime,
			onInit: function(){
				$("#dateinterval").intervalWialon('set', 0);
			},
			onAfterClick: function () {
				$(".date-time-content").resize();
			}
		};

		if (locale && locale.fd) {
			var format = locale.fd.split("_");
			if (format.length == 2) {
				// options.dateFormat = convertDateFormat(format[0], true);
				options.dateFormat = wialon.util.DateTime.convertFormat(format[0], true);
				DATE_FORMAT = wialon.util.DateTime.convertFormat(locale.fd, true);
				FIRST_DAY = locale.wd;
				options.firstDay = locale.wd;
			}
		}

		$("#dateinterval").intervalWialon(options);
	});

	MEASURE = user.getMeasureUnits();
	if (MEASURE == 1) {
		$("#sort_3").html($.localise.tr("Mileage") + ", " + $.localise.tr("mi"));
		$("#trip-length-limit").slider("value", $("#trip-length-limit").slider("value"));
		LOCAL_STATE.speed_limit = LOCAL_STATE.speed_limit_us;
	}

	var html = "";
	for (var j=0; j<LOCAL_STATE.speed_color.length; j++) {
		html += "<div class='speed-block'>";
		html += "<span>" + LOCAL_STATE.speed_limit[j] + "</span>";
		html += "<div class='speed-color' style='background:" + LOCAL_STATE.speed_color[j] + "'></div></div>";
	}
	$("#legend").html( html );

	var server_time = wialon.core.Session.getInstance().getServerTime();
	TZ = wialon.util.DateTime.getTimezoneOffset();
	DST = wialon.util.DateTime.getDSTOffset(server_time);
	var tt = new Date(get_user_time(server_time, TZ, DST)*1000);
	tt.setHours(0);
	tt.setMinutes(0);
	tt.setSeconds(0);
	tt.setMilliseconds(0);
	var tnow = new Date(tt);
	tnow.setSeconds(tnow.getSeconds() + 86399);

	TIMEZONE_DIFF = -1 * get_local_timezone() + TZ + DST;

	TODAY.from = tt.getTime()/1000 | 0;
	TODAY.to = tnow.getTime()/1000 | 0;
	
	$("#dateinterval").intervalWialon("set", 0);
	wialon.core.Session.getInstance().loadLibrary("itemIcon");
	wialon.core.Session.getInstance().loadLibrary("unitDriveRankSettings");
	changeType("avl_unit");
	wialon.core.Remote.getInstance().finishBatch(null, "initBatch");

	// kill session on page refresh
	window.onbeforeunload = function () {
		wialon.core.Session.getInstance().logout();
	};
}

/** Change type of object dealing with (search, analyth etc.)
 *  For now (v1.1) the only type is 'avl_unit', in future would be helpful
 */
function changeType(type) {
	var user = wialon.core.Session.getInstance().getCurrUser();

	var flags = wialon.item.Item.dataFlag.base |
				wialon.item.Item.dataFlag.image |
				wialon.item.Item.dataFlag.customProps |
				0x20000;
	searchItems(
		qx.lang.Function.bind(function (items) {
			if (type == "avl_unit") {
				// count of units with settings
				var okUnits = 0;
				// can exec report
				var canExec = true;

				wialon.core.Remote.getInstance().startBatch("driveRankSettings");

				// check if can exec report
				wialon.core.Session.getInstance().searchItem(user.getAccountId(), 0x1, function(code, data) {
					if (code || !data || !(data.getUserAccess() & wialon.item.Resource.accessFlag.viewReports)) {
						canExec = false;
						$("#overlay-all").html(
							'<div class="info">' +
							$.localise.tr("You do not appear to have access \"View report templates\" to your account.") +
							'</div>'
						).show();
						$("#add-unit").empty();
					}
				});

				for (var u = 0; u < items.length; u++) {
					items[u].getDriveRankSettings(qx.lang.Function.bind(function (unit, code, data) {
						unit.driveRankSettings = false;
						if (code === 0 && !("error" in data) && !($.isEmptyObject(data))) {
							unit.driveRankSettings = true;
							okUnits++;
						}
					}, this, items[u]));
				}
				wialon.core.Remote.getInstance().finishBatch(function () {
					// sort
					items.sort(function (a, b) {
						if (a.driveRankSettings == b.driveRankSettings) {
							return a.getName().toUpperCase() > b.getName().toUpperCase() ? 1 : -1;
						} else {
							return a.driveRankSettings > b.driveRankSettings ? -1 : 1;
						}
					});

					// change phrases if no configured units
					if (okUnits === 0) {
						$("#add-unit").html($.localise.tr("You have no units with adjusted driving criteria."));
					}

					$("#items").html(fillListWithItems(items, canExec));
					addTab("tab_"+LOCAL_STATE.tab_index++);

					if (canExec) {
						var ids = $.cookie("idrive");
						if (typeof ids === "undefined"){
							// toDo: first start
						} else {
							ids = ids ? ids.split(",") : [];
							for (var i = 0; i < ids.length; i++) {
								var unit = findUnit(ids[i]);
								if (unit && unit.driveRankSettings){
									execute(ids[i]);
									$("#item_"+ids[i]).hide();
								}
							}
						}
					}
				}, "driveRankSettings");
			}
		}, this),
		flags
	);
}

/** Search items function
 *
 *  @param {Function} callback   function to be executed after all operations
 *  @param {int} flags   wialon flags
 *  @param {bool} force   is force update needed (if false - get units from cache)
 *  @param {String} type   type of objects ('avl_units')
 */
function searchItems(callback, flags, force, type){
	flags = flags || wialon.item.Item.dataFlag.base;
	force = force || true;
	type = type || "avl_unit";
	
	if (!force && LOCAL_STATE.item_cache[type]){
		callback(LOCAL_STATE.item_cache[type]);
	} else {
		var spec = {itemsType: type,propName: "sys_name",propValueMask: "*",sortType: "sys_name"};
		wialon.core.Session.getInstance().searchItems(spec, true, flags, 0, 0,
			qx.lang.Function.bind(function (cb, code, data) {
				if (code === 0 && data) {
					LOCAL_STATE.item_cache[type] = data.items;
					cb(LOCAL_STATE.item_cache[type]);
				} else {
					alert($.localise.tr("No data for selected interval"));
				}
			}, this, callback));
	}
}

/** Construct html list of found units
 *
 *  @param {Array} items   found in searchItems items
 *  @param {Boolean} canExec   if user can exec report
 *  @returns {String} html list of items
 */
function fillListWithItems(items, canExec){
	var html = [], prop = null, cache = [];
	var template = _.template($("#item-template").html());
	wialon.core.Remote.getInstance().startBatch("UpdateCustomPropeties");
	for (var i=0,len=items.length; i<len; i++) {
		var unit = items[i];
		if (!unit) continue;
		
		var id = unit.getId();
		
		var tmp = template({
			"img": "",
			"key": id,
			"value": unit.getName(),
			"active": unit.driveRankSettings && canExec
		});
		html.push(tmp);
		cache.push([id,unit.getIconUrl(16)]);
		prop = unit.getCustomProperty("idrive");
		if (!prop) {
			LOCAL_STATE.unit_opts[id] = [1,1];
			unit.updateCustomProperty("idrive", "1;1");
		} else {
			prop = prop.split(";");
			if (prop && prop.length==2) {
				LOCAL_STATE.unit_opts[id] = [parseInt(prop[0],10),parseInt(prop[1],10)];
			} else {
				LOCAL_STATE.unit_opts[id] = [1,1];
			}
		}
	}
	wialon.core.Remote.getInstance().finishBatch(null, "UpdateCustomPropeties");
	
	var ID = setInterval(function(){
		if(cache.length){
			var j = 0, tmp = [];
			while(cache.length && (j++)<10){
				tmp=cache.shift();
				$("#item_"+tmp[0]+" .item-img img").attr("src", tmp[1]);
			}
		}else {
			clearInterval(ID);
		}
	},150);
	
	return html.join("");
}

/** Onload translation
 *  Translate text on page
 */
function ltranslate () {
	$("#sort_1").html($.localise.tr("Unit"));
	$("#sort_2").html($.localise.tr("Penalty"));
	$("#sort_3").html($.localise.tr("Mileage") + ", " + $.localise.tr("km"));
	$("#sort_5").html($.localise.tr("Duration"));
	$("#sort_4").html($.localise.tr("Trips"));
	$("#sort_6").html($.localise.tr("Violations"));
	
	$("#add-unit").html($.localise.tr("Add units from the list on the left"));

	$("#tabs .add-tab").attr("title", $.localise.tr("New tab"));
	
	$("#show-all").attr("title", $.localise.tr("Show on map"));
	
	$("#no-data").html($.localise.tr("No data for selected interval"));

	if (LANG == "ru") {
		$("#header .help").attr("href", "/docs/ru/ecodriving.html");
	}
}

/** Main initialization and handlers binding
 */
$(document).ready(function () {
	var url = get_url_parameter("baseUrl");
	if (!url)
		url = get_url_parameter("hostUrl");
	if (!url)
		return;

	LANG = get_url_parameter("lang");
	if ((!LANG) || ($.inArray(LANG, ["en", "ru", "sk", "ee", "fi", "es", "lv", "hu", "de", "fr"]) == -1))
		LANG = "en";

	// load datepicker locale
	if (LANG != "en") {
		load_script("//apps.wialon.com/plugins/wialon/i18n/" + LANG + ".js");
	}

	// translation phrases
	$.localise("lang/", {
		language: LANG,
		async: true,
		complete: ltranslate
	});

	// wialon.js
	url += "/wsdk/script/wialon.js";
	load_script(url, init_sdk);
	
	var w = $.cookie("idrive-width");
	if (w) resizePanel($("#items"), $("#drag"), $("#statistic"), $(window).width(), {pageX:parseInt(w,10)});

	/// generate ticks for plot
	var j=0, ticks = [];
	ticks.push( LOCAL_STATE.criteria[j].yaxis.from );
	for (; j<LOCAL_STATE.criteria.length; j++){
		ticks.push( LOCAL_STATE.criteria[j].yaxis.to );
	}

	/// BINDS
	$("#items").on("click", ".arrow", function(){
		var id = $(this).parent().attr("id").split("_")[1];
		var unit = findUnit(id);
		if (findUnitOnTab(LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab], id) || !unit || !unit.driveRankSettings)
			return;
		if (LOCAL_STATE.last_sel_tab=="tab_0")
			toggleCookie(id);
		execute(id);
		$(this).parent().hide();
	});
	
	$("#items").on("dblclick", ".item", function(){
		var id = $(this).attr("id").split("_")[1];
		var unit = findUnit(id);
		if (findUnitOnTab(LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab], id) || !unit || !unit.driveRankSettings)
			return;
		if (LOCAL_STATE.last_sel_tab=="tab_0")
			toggleCookie(id);
		execute(id);
		$(this).hide();
	});
	
	$("#drag").mousedown(function(e){
		e.preventDefault();
		LOCAL_STATE.dragging = true;
		var left = $("#items");
		var center = $("#drag");
		var right = $("#statistic");
		var width = $(window).width();
		$(document).mousemove(qx.lang.Function.bind(resizePanel, this, left, center, right, width));
	});
	
	$(document).mouseup(function(e){
		if (LOCAL_STATE.dragging){
			LOCAL_STATE.dragging = false;
			$(document).unbind('mousemove');
			var t = resizePanel($("#items"), $("#drag"), $("#statistic"), $(window).width(), e);
			$.cookie("idrive-width", t, {expires: 300});
		}
	});
	
	$("#all-stat").on("click", ".item_tr", function(evt){
		var id = $(this).attr("id").split("_")[1];
		if($(evt.target).hasClass("update")){
			$(this).children(".rate, .mileage, .duration, .trips, .violations").html("<img src='./img/loader.gif'/>");
			$(this).children(".duration").attr("title","").removeClass("update");
			execute(id, true);
		} else {
			var new_tab = "tab_"+LOCAL_STATE.last_sel_tab.split("_")[1]+"_"+id+"_"+LOCAL_STATE.tab_index++;
			addTab(new_tab);
			LOCAL_STATE.last_sel_tab = new_tab;
		}
	});
	
	$("#all-stat")
		.on("click", ".delete-stat", function(){
			var tab = LOCAL_STATE.last_sel_tab;
			var id = $(this).parent().attr("id").split("_")[1];
			for (var i=0; i<LOCAL_STATE.tabs[tab].units.length; i++) {
				if(LOCAL_STATE.tabs[tab].units[i].id == id){
					abortRequest(LOCAL_STATE.tabs[tab].units[i]);
					LOCAL_STATE.tabs[tab].units[i] = null;
					LOCAL_STATE.tabs[tab].units.splice(i,1);
					break;
				}
			}
			if(LOCAL_STATE.tabs[tab].stat[id]) {
				LOCAL_STATE.tabs[tab].stat[id] = null;
				delete LOCAL_STATE.tabs[tab].stat[id];
			}

			$(this).parent().remove();
			$("#item_"+id).show();

			if (tab=="tab_0")
				toggleCookie(id, true);

			if (!LOCAL_STATE.tabs[tab].units.length)
				$("#add-unit").show();

			return false;
		})
		.on("click", ".sort-table", function(){
			if(!LOCAL_STATE.last_sel_tab) return false;
			var tab = LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab];
			if (!tab.tab_type) {
				$("#all-stat .sort:visible").css("display","none");
				var sort = this.id.split("_")[1] | 0;
				if (Math.abs(tab.sort)==sort)
					tab.sort *= -1;
				else
					tab.sort = sort;
				$(this).next("img").css("display","inline-block").attr("src","img/"+(tab.sort>0?"az.png":"za.png"));
				sortUnits(tab);
				showMenu(LOCAL_STATE.last_sel_tab, true);
			}
			return false;
		});

	$("#viol-table").on("click", ".viol-tr", function(){
		if(!MAP) return;
		var t = $("#viol-table tr.selected");
		if (t.size()) {
			t.removeClass("selected");
			MARKERS[t.data("index")].closePopup();
			$(MARKERS[t.data("index")]._icon).children(".number").removeClass("selected");
		}
		
		$(this).addClass("selected");
		
		$(MARKERS[$(this).data("index")]._icon).children(".number").addClass("selected");
		MAP.panTo([$(this).data("y"), $(this).data("x")]);
	});
	
	$("#show-all").on("click", function(){
		if(!MAP) return;
		if (MAP && LOCAL_STATE.map_bounds.length)
			MAP.fitBounds(LOCAL_STATE.map_bounds, {padding:[10,10]});
	});
	
	$("#tabs")
		.on("click", ".tab", function(){
			switchTab(this.id);
		})
		.on("click", ".add-tab", function(){
			if($("#tabs .limited-tab").size() < 4){
				addTab("tab_"+LOCAL_STATE.tab_index++);
			}
			if($("#tabs .limited-tab").size() >= 4){
				$("#tabs .add-tab").hide();
			}
		})
		.on("click", ".closetab", function(){
			closeTab($(this).prev().attr("id"));
			if($("#tabs .limited-tab").size() < 4){
				$("#tabs .add-tab").show();
			}
		});
	
	$("#footer .scroll")
		.on("resize", function(){
			if($(this).innerWidth() < this.scrollWidth && $("#footer .arrow").css("display")=="none"){
				$("#footer .arrow").show();
			} else if ($(this).innerWidth() == this.scrollWidth && $("#footer .arrow").css("display")=="block") {
				$("#footer .arrow").hide();
			}
		})
		.on("mousewheel", function(event, delta){
			this.scrollLeft -= (delta * 30);
			event.preventDefault();
		});
	
	$("#footer .arrow").on("click", function(){
		if($(this).hasClass("left")) {
			$("#footer .scroll").get(0).scrollLeft -= 30;
		} else if($(this).hasClass("right")){
			$("#footer .scroll").get(0).scrollLeft += 30;
		}
	});
	
	$("#change-time-btn").on("click", function(){
		var tab = null;
		if (LOCAL_STATE.last_sel_tab)
			tab = LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab];
		var interval = get_time_from_input();
		if (tab.time_from==interval[0] && tab.time_to==interval[1])
			return false;
		tab.time_from = interval[0];
		tab.time_to = interval[1];
		updateTabTime();
		return false;
	}).removeAttr("href");

	PLOT = $.plot("#plot", [],
		{
			xaxis:{show:false, min:-60},
			colors: ["#7c93b3"],
			zoom: {interactive: true},  pan: { interactive: true},
			yaxis:{min:0,  max:100 /*, ticks:ticks*/, panRange:false, zoomRange:false,  autoscaleMargin:null},
			grid:{
				autoHighlight:true, hoverable:true, clickable:true,
				axisMargin:0, borderWidth:0, labelMargin:10,
				/*markings:LOCAL_STATE.criteria,*/
				margin:{top:30, bottom:20}
			}
		}
	);
	
	$(".date-time-content").on("resize", function(evt, w){
		w = (w || $(this).width()) - 40;
		var res = w - $("#dateinterval").width() - $(".trip-length").width();
		$("#item-info-block").width(res).children(".unit").css("max-width", res - 100);
	});
	
	$("#plot").bind("plothover", function (event, pos, item) {
		if (item){
			if (LOCAL_STATE.last_flot_hover == item.dataIndex){
				var off = PLOT.getPlotOffset();
				var x = item.datapoint.length === 3 ?
					(PLOT.p2c({x1:item.datapoint[0]+item.datapoint[2]/2}).left|0) - 95 + off.left:
					item.pageX - 95;
				if(x < 5)
					x = 5;
				else if( $(window).width()-x < 195 )
					x = $(window).width() - 195;
				$("#plot-hover").offset({ left: x});
				return;
			}
			LOCAL_STATE.last_flot_hover = item.dataIndex;
			toggleHover(item);
		} else if (LOCAL_STATE.last_flot_hover !== null) {
			LOCAL_STATE.last_flot_hover = null;
			toggleHover();
		}
	});
	
	$("#plot").bind("plotclick", function (event, pos, item) {
		if($("#ui-datepicker-div").css("display") == "block")
			$("#ui-datepicker-div").datepicker("hide");
		if (item){
			if (LOCAL_STATE.last_flot_click == item.dataIndex){
				if (MAP && LOCAL_STATE.map_bounds.length)
					MAP.fitBounds(LOCAL_STATE.map_bounds, {padding:[10,10]});
			} else {
				LOCAL_STATE.last_flot_click = item.dataIndex;
				showViolations(LOCAL_STATE.last_sel_tab, item.dataIndex);
				PLOT.unhighlight();
				PLOT.highlight(item.series, item.datapoint);
			}
		}
	});
});

/** Initialize MAP object
 */
function initMap() {
	var gis_url = wialon.core.Session.getInstance().getBaseGisUrl();
	var user_id = wialon.core.Session.getInstance().getCurrUser().getId();
	var gurtam = L.tileLayer.webGis(gis_url,{ attribution: "Gurtam Maps",minZoom: 4, userId: user_id});
	var osm = L.tileLayer('http://{s}.tile.osm.org/{z}/{x}/{y}.png', {
		attribution: '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors',
		minZoom: 4
	});
	
	var cur = gurtam;
	var layer = $.cookie("idrive-map");
	if (layer) {
		switch(layer){
			case "Gurtam Maps": cur=gurtam; break;
			case "OpenStreetMap": cur=osm; break;
		}
	} else {
		$.cookie("idrive-map", "Gurtam Maps", {expires: 300});
	}
	
	MAP = L.map("map", {
		center: [53.505,28.49],
		zoom: 6,
		layers: [ cur ]
	});
	
	MAP.addEventListener("baselayerchange", function(evt){
		$.cookie("idrive-map", evt.name, {expires: 300});
	});
	
	var layers = {
		"Gurtam Maps": gurtam,
		"OpenStreetMap": osm
	};
	
	L.control.layers(layers).addTo(MAP);
}

/** Update tab content when time interval changed
 */
function updateTabTime(){
	var tab_id = LOCAL_STATE.last_sel_tab;
	var tab = LOCAL_STATE.tabs[tab_id];
	if (tab){
		if (tab.tab_type) { // unit tab update
			execute(tab_id.split("_")[2], true);
			
			cleanMap();
			$("#viol-table").html("");
			$("#viol-header").hide();
			$("#item-info-block .rate").html("");
			PLOT.setData([]);
			PLOT.unhighlight();
			PLOT.draw();
		} else { // stat tab update
			for (var i=0; i<tab.units.length; i++) {
				abortRequest(tab.units[i]);
				if(tab.units[i].timeout){ clearTimeout(tab.units[i].timeout); }
				tab.units[i].timeout = setTimeout(qx.lang.Function.bind(execute, this, tab.units[i].id, true), 1000);
				$("#row_"+tab.units[i].id).children(".rate, .mileage, .duration, .trips, .violations").html("<img src='./img/loader.gif'/>");
				$("#row_"+tab.units[i].id).children(".duration").attr("title","").removeClass("update");
			}
		}
	}
}

/** Change time handler
 *
 *  @param {Array} data   event params (check info below)
 *
 *  [
 *     value, // type of interval. Possible values: 0 - yesterday, 1 - today, 2 - week, 3 - month, 4 - custom
 *     interval // [from, to] date interval
 *  ]
 */
function changeTime(data) {
	var value = data[0], interval = data[1];
	var tab_id = LOCAL_STATE.last_sel_tab;
	if (LOCAL_STATE.tabs[tab_id]){
		LOCAL_STATE.tabs[tab_id].time_type = value;
		LOCAL_STATE.tabs[tab_id].time_from = interval[0];
		LOCAL_STATE.tabs[tab_id].time_to = interval[1];

		updateTabTime();
	}

	activateTimeTemplate(value);
}

/** Activate interval time ( tab labels )
 *
 *  @param {int} value   type of interval. Possible values: @see changeTime
 *  @returns {bool}   true - done without errors, false - activation failed
 */
function activateTimeTemplate(value){
	var label = $("#dateinterval").intervalWialon("label");

	var tab = LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab];
	if (tab && !tab.tab_type) {
		tab.name = label;
		$("#"+LOCAL_STATE.last_sel_tab)
			.html(value<4 ? label : $.localise.tr("Custom"))
			.attr("title", value<4 ? label.replace(/&ndash;/g, "-").replace(/&nbsp;/g, " ")  : $.localise.tr("Custom"));
	}

	$(".date-time-content").resize();
	return true;
}

/** Get data from server
 *
 *  @param {int} id   unit id
 *  @param {bool} update   if unit already shown on tab and need just update data without adding new row
 */
function execute(id, update) {
	if (!id) return;
	var interval = get_time_from_input(true);
	var tab = LOCAL_STATE.last_sel_tab;
	
	if (!id || !interval || interval.length!=2) return;
	
	if (!update) {
		if (addRowToTable(id))
			LOCAL_STATE.tabs[tab].units.push({"id":id, "xhr":null, "timeout":null});
	} else {
		LOCAL_STATE.tabs[tab].stat[id] = null;
		delete LOCAL_STATE.tabs[tab].stat[id];
	}
	// find right unit request
	var req = findUnitOnTab(LOCAL_STATE.tabs[tab], id);

	// additional info
	req.interval = interval;
	req.tab = tab;

	// abort previous request
	abortRequest(req);
	// query Request
	queryRequest(req);
}

/** Abort request if still pending
 *
 *  @param unit   internal {unit_on_tab} object, @see findUnitOnTab
 */
function abortRequest(unit){
	if (unit && unit.xhr){
		unit.xhr = null;
	}
}

/** Add unit row to statistic table
 *
 *  @param {int} id   unit id
 *  @returns {bool} is operation was successful
 */
function addRowToTable(id){
	var template = _.template($("#all-stat-row").html());
	var unit = findUnit(id);
	if (!unit || !unit.driveRankSettings)
		return false;
	$("#add-unit").hide();
	var tmp = template({
		"id": id,
		"img": unit.getIconUrl(16),
		"name": unit.getName()
	});
	$("#all-stat tbody").append(tmp);
	return true;
}

/** Query
 * @param {Object} req   unit request object
 */
function queryRequest(req) {
	// append request to query
	if (req) {
		QUERY.push(req);
	}
	// get first if any and no active request
	if (QUERY.length) {
		if (ACTIVE === null) {
			ACTIVE = QUERY.pop();
			ACTIVE.xhr = 1;
			// exec report
			execReport(ACTIVE);
		}
	}
}

/** Exec report
 * @param {Object} req   request object (contains info about unit, time interval, tab)
 */
function execReport (req) {
	if (req.tab == LOCAL_STATE.last_sel_tab && LOCAL_STATE.tabs[req.tab].tab_type) {
		$("#overlay-tab").show();
	}

	// General batch
	var params = [{ // exec report
		svc: 'report/exec_report',
		params:{
			reportResourceId: wialon.core.Session.getInstance().getCurrUser().getAccountId(),
			reportTemplateId: 0,
			reportObjectId: req.id,
			reportObjectSecId:0,
			interval: {
				flags: 0,
				from: req.interval[0],
				to: req.interval[1]
			},
			reportTemplate:{
				n: 'EcoDriving report',
				ct: 'avl_unit',
				p:'',
				tbl:[{
					n: 'unit_ecodriving',
					l: 'Driving behavior',
					f: 0x200110,
					c: 'time_begin,time_end,violation_name,violation_value,max_speed,violation_mark,violations_count',
					cl: 'Beginning,End,Violation name,Value,Max speed,Mark,Violation count',
					sl: '',
					s:'',
					p: '{"unfinished_ival":0,"duration_format":0}',
					sch: {y:0,m:0,w:0,f1:0,f2:0,t1:0,t2:0}
				}, {
					n: 'unit_trips',
					l: 'Trips',
					f: 0x10,
					c: 'time_begin,time_end,duration,mileage',
					cl: 'Beginning,End,Duration,Mileage',
					sl: '',
					s: '',
					p: '{"unfinished_ival":0,"base_eh_sensor":{"mask":"*"},"sensor_name":"*","duration_format":"0"}',
					sch: {y:0,m:0,w:0,f1:0,f2:0,t1:0,t2:0}
				}]
			}
		}
	}, { // get driving behavior result
		svc: 'report/select_result_rows',
		params: {
			'tableIndex': 0,
			'config': {
				'type': 'range',
				'data': {
					'from': 0,
					'to': 0xFFFF,
					'level': 1,
					'rawValues': 1
				}
			}
		}
	}, { // get unit trips
		svc: 'report/select_result_rows',
		params: {
			'tableIndex': 1,
			'config': {
				'type': 'range',
				'data': {
					'from': 0,
					'to': 0xFFFF,
					'level': 1,
					'rawValues': 1
				}
			}
		}
	}, { // cleanup report result
		svc: 'report/cleanup_result',
		params: {}
	}];

	wialon.core.Remote.getInstance().remoteCall('core/batch', params, function (code, obj) {
		// if a still alive

		var finalData = {
			mileage: 0,
			duration: 0,
			trips: [],
			violations_count: 0 // violations count
		};

		ACTIVE = null;
		queryRequest();


		if (code === 0 && obj && obj.length && obj.length == 4 && !('error' in obj[0]) && ('reportResult' in obj[0])) {

			var result = obj[0].reportResult;

			// both unit_driverank and unit_trips exists
			// get data from Total
			if (result.tables.length == 2) {
				// result.tables[0] - unit_driverank
				finalData.rate = result.tables[0].total[5];
				// result.tables[1] - unit_trips
				finalData.mileage = result.tables[1].totalRaw[3].v;
				finalData.duration = result.tables[1].totalRaw[2].v;
			}

			var trips = obj[2];
			var violations = obj[1];
			// sometimes errors' comming
			if (trips.error) {
				trips = [];
			}
			if (violations.error) {
				violations = [];
			}
			// construct result array
			for (var i = 0, vi = 0; i < trips.length; i++) {
				// init violations stats
				trips[i].viol = {};
				trips[i].rate = 0;
				// check if violations were in cur trip
				if (vi < violations.length && trips[i].t1 <= violations[vi].t1 && violations[vi].t2 <= trips[i].t2) {
					trips[i].rate = parseInt(violations[vi].c[5].t, 10);
					if (violations[vi].r) {
						finalData.violations_count += violations[vi].r.length;
						// trips violation loop
						for (var j = 0, viol = null; j < violations[vi].r.length; j++) {
							// violation
							viol = violations[vi].r[j].c;
							// group violations by type
							if (!(viol[2].v in trips[i].viol)) {
								trips[i].viol[viol[2].v] = [viol];
							} else {
								trips[i].viol[viol[2].v].push(viol);
							}
						}
					}
					vi++;
				}
			}
			// add tirps to final data
			finalData.trips = trips;
			// show result data
			handleData(req.tab, req.id, finalData);
		}
	});
}


/** Handle report data ( @see execute )
 *
 *  @param {String} tab   tab id
 *  @param {int} id   unit id
 *  @param {object} data   json data about unit
 */
function handleData(tab, id, data) {
	var unit = findUnitOnTab(LOCAL_STATE.tabs[tab], id);
	if (!unit || !unit.xhr){
		return;
	}
	if (data.hash && unit.xhr && data.hash!=unit.xhr.hash){
		return;
	}
	
	unit.xhr = null;
	if (tab == LOCAL_STATE.last_sel_tab)
		$("#overlay-tab").hide();
	
	var obj = data;
	if (!data.trips || data.trips.length === 0){
		obj.ia = obj.ib = obj.it = obj.na = obj.nb = obj.nt = null;
		obj.total_time = obj.R = obj.rate = obj.ka = obj.kb = obj.kt =null;
		obj.trips = [];
		obj.plot_trips = [];
	}
	
	LOCAL_STATE.tabs[tab].stat[id] =  obj;
	
	if (LOCAL_STATE.last_sel_tab == tab) {
		populateStat(tab, id);
	}
	
	var cur = {};
	if (!LOCAL_STATE.tabs[tab].tab_type) {
		for (var itab in LOCAL_STATE.tabs) {
			cur = LOCAL_STATE.tabs[itab];
			if (!cur.tab_type || cur.parent!=tab) continue;
			if ( cur.time_from==LOCAL_STATE.tabs[tab].time_from && cur.time_to==LOCAL_STATE.tabs[tab].time_to){
				var u = findUnitOnTab(cur,id);
				if (!u) continue;
				abortRequest(u);
				cur.stat[id] = clone(LOCAL_STATE.tabs[tab].stat[id]);
				populateStat(itab, id);
				$("#overlay-tab").hide();
			}
		}
	}
}

/** Update info on tab after calculation (statistic or unit tab)
 *
 *  @param {String} tab   tab id
 *  @param {int} id   unit id
 *  @param {int} limit   min trip length
 *  @param {bool} leave   leave same trip selected (otherwise, select trip with min rate)
 */
function populateStat(tab, id, limit, leave){
	var tab_info = tab.split("_");
	
	if (tab_info.length==2) {
		var tag = $("#row_"+id), stat = LOCAL_STATE.tabs[tab].stat[id];
		var mileage = 0;
		if (LOCAL_STATE.tabs[tab].stat[id]) {
			if(stat.error){
				tag.children(".rate, .mileage, .duration, .trips, .violations").html("");
				tag.children(".duration").attr("title", $.localise.tr("Error while getting data")).addClass("update");
			} else {
				mileage = "-";
				if(stat.mileage){
					if (MEASURE == 1) {
						mileage = (stat.mileage * KM2MI / 1000).toFixed(1);
					} else {
						mileage = (stat.mileage / 1000).toFixed(1);
					}
				}
				tag.children(".duration").html( stat.duration ? toHHMMSS(stat.duration) : "-" );
				tag.children(".mileage").html(mileage);
				tag.children(".rate").html(stat.rate != null ? stat.rate : "-");
				tag.children(".trips").html(stat.trips.length || "-");
				tag.children(".violations").html(stat.trips.length ? stat.violations_count : "-");
			}
		} else {
			tag.children(".rate, .mileage, .duration, .trips, .violations").html("<img src='./img/loader.gif'/>");
			tag.children(".duration").attr("title","").removeClass("update");
		}
	} else if (tab_info.length==4) {
		showStatistic(tab, limit, leave);
	}
}

/* Show calculated statistic on unit tab
 *
 *  @param {String} tab   tab id
 *  @param {int} limit   min trip length
 *  @param {bool} leave   leave same trip selected (otherwise, select trip with min rate)
 */
function showStatistic(tab_id, limit, leave){
	var tab_info = tab_id.split("_");
	if (tab_info[0]!="tab" || tab_info.length!=4)
		return;
	
	var tab = LOCAL_STATE.tabs[tab_id];
	var unit = findUnit(tab_info[2]);
	if(!tab.stat[tab_info[2]] || !tab.stat[tab_info[2]].trips || !unit)
		return;
	
	cleanMap();
	toggleHover();
	$("#viol-table").html("");
	$("#viol-header").hide();
	
	$("#item-info-block .rate")
		.html(tab.stat[tab.units.id].rate ? tab.stat[tab.units.id].rate + "" : "&nbsp;")
		.attr("title", tab.stat[tab.units.id].rate != null ? tab.stat[tab.units.id].rate : "");
	$("#item-info-block .unit").html(unit.getName());
	
	var from_to = $("#dateinterval").intervalWialon("label");
	var txt = " " + (MEASURE == 1 ? $.localise.tr("mi") : $.localise.tr("km"));
	var format_limit = (MEASURE == 1 ? (limit * KM2MI).toFixed(1) : limit);

	$("#plot-name").html(
		wialon.util.String.sprintf(
			$.localise.tr("Trips for %s ") + (limit>0 ? $.localise.tr("not shorter than %s") + txt : "%s") ,
			"<b><i>"+from_to+"</i></b>", (limit>0 ? "<b>"+format_limit+"</b>" : "")
	));
	var trips = tab.stat[tab_info[2]].trips;
	var K = [], max = trips.length, plot_trips = [], maxRate = 0;
	var select_index = 0, select_value = 0, limited_count = 0, total = 0, t = 0;
	for (var i = 0, r = 0; i < max; i++){
		if ((limit > 0 && trips[i].m < limit*1000) || (trips[i].m === 0)) {
			limited_count++;
			continue;
		}
		
		t = trips[i].t2 - trips[i].t1;
		r = trips[i].rate > 0 ? trips[i].rate : 0.7;
		K.push([total, r, t]);
		// calculate plot max Y
		if (r > maxRate) {
			maxRate = r;
		}

		total += t+60;
		plot_trips.push(i);
		if (trips[i].rate > select_value) {
			select_value = trips[i].rate;
			select_index = i - limited_count;
		}
	}
	
	$("#no-data").css("display", max==limited_count || max===0 ? "block" : "none");
	
	tab.stat[tab_info[2]].plot_trips = plot_trips;
	
	PLOT.unhighlight();
	PLOT.setData([{data:K, bars:{show:true, lineWidth:1, strokeColor:"rgba(255,255,255,0.5)", align:"left"}}]);
	var opts = PLOT.getXAxes()[0].options;
	opts.min = -60;
	opts.max = total;
	opts.panRange = [-61,total+1];
	opts.zoomRange = [600,total+62];
	if (K.length) {
		if(leave)
			select_index = LOCAL_STATE.last_flot_click;
		else
			LOCAL_STATE.last_flot_click = select_index;
		showViolations(tab_id, select_index);
	}

	PLOT.getYAxes()[0].options.max = maxRate + 10;

	PLOT.setupGrid();
	PLOT.draw();
	PLOT.highlight(0, select_index, true);
}

/** Construct menu and statistic tab
 *
 *  @param {String} id_tab   tab id
 *  @param {bool} after_sort   true - redraw after sort
 */
function showMenu(id_tab, after_sort){
	var tab = LOCAL_STATE.tabs[id_tab];
	if (tab.tab_type)
		return;
	$("#all-stat tbody").html("");
	$("#items .item").show();
	if (!after_sort) {
		$("#all-stat .sort:visible").css("display","none");
		if (tab.sort) {
			$("#sort_"+Math.abs(tab.sort)).next("img")
				.attr("src","img/"+(tab.sort>0?"az.png":"za.png"))
				.css("display","inline-block");
		}
	}
	if (tab.units.length) {
		$("#add-unit").hide();
		for (var i=0; i<tab.units.length; i++) {
			$("#item_"+tab.units[i].id).hide();
			addRowToTable(tab.units[i].id);
			populateStat(id_tab, tab.units[i].id);
		}
	} else {
		$("#add-unit").show();
	}
}

/** Resize unit list panel (drag handler)
 *
 *  @param {jQuery object} left   unit list
 *  @param {jQuery object} center   2px width vertical line between panels
 *  @param {jQuery object} right   statistic panel
 *  @param {int} width   window width
 *  @param {event}   mousemove drag event
 */
function resizePanel(left, center, right, width, e){
	var val = e.pageX;
	// left scroll offset
	var a = 0;
	// if horizontal scroll
	if (width < 1004) {
		a = $('body').scrollLeft();
	}
	// check right min size
	if(width - val + a < 50) {
		val = width + a - 50;
	}
	// check left min size
	if (val < a + 70) {
		val = a + 70;
	}
	if (width < 1004) {
		width = 1004;
	}
	// convert to percent
	var percent = val / (width) * 100;
	center.css("left", percent + "%");
	left.css("width", percent + "%");
	right.css("width", (100 - percent) + "%");

	return val;
}

/** Plot hover handler
 *
 *  @param {object} item   mouseover'ed item on plot
 */
function toggleHover(item) {
	var tab = LOCAL_STATE.tabs[ LOCAL_STATE.last_sel_tab ];
	if (!item || !tab.tab_type) {
		$("#plot").css("cursor", "default");
		$("#plot-hover").stop(0, 1).fadeOut(200);
	} else {
		$("#plot").css("cursor", "pointer");
		if (tab && tab.stat[tab.units.id]){
			var plot_index = tab.stat[tab.units.id].plot_trips[item.dataIndex];
			var stat = tab.stat[tab.units.id].trips[plot_index];
			var obj = $("#plot-hover");
			
			var from_to = formatDateRange(
				wialon.util.DateTime.formatTime(stat.t1, false, DATE_FORMAT),
				wialon.util.DateTime.formatTime(stat.t2, false, DATE_FORMAT)
			);
			
			var trip = " ";
			var mile = stat.c[3].v;
			if (MEASURE == 1) {
				trip += (mile * KM2MI / 1000).toFixed(1) + " " + $.localise.tr("mi");
			} else {
				trip += (mile / 1000).toFixed(1) + " " + $.localise.tr("km");
			}
			obj.find(".time").html(from_to);
			obj.find(".rate").html("<b>" + stat.rate + "</b>");
			obj.find(".mileage").html($.localise.tr("Trip length") + trip  + ", " + toHHMMSS(stat.t2 - stat.t1));
			
			var violations = "", label = "", cl = "";
			for (var v in stat.viol) {
				label = cl = "";
				if (LOCAL_STATE.violation_types[v]) {
					label = $.localise.tr(LOCAL_STATE.violation_types[v].name);
					cl = LOCAL_STATE.violation_types[v].cl;
				}
				violations +=
					"<div class='" + cl + "'>" +
						"<b>" + stat.viol[v].length + "</b>" +
						"<span>" + label + "</span>" +
					"</div>";
			}
			obj.find(".violations").html(violations);

			var x = item.datapoint.length === 3 ?
				(PLOT.p2c({x1:item.datapoint[0]+item.datapoint[2]/2}).left|0) - 95 + PLOT.getPlotOffset().left:
				item.pageX - 95;
			if(x < 5)
				x = 5;
			else if( $(window).width()-x < 195 )
				x = $(window).width() - 195;
			obj.stop(0, 1).fadeIn(100).offset({ left: x });
		} else {
			$("#plot-hover").stop(0, 1).fadeOut(200);
		}
	}
}

/** Convert seconds to pretty time label
 *
 *  @param {int} sec   seconds
 *  @returns {String} formatted 'hh:mm:ss' string
 */
function toHHMMSS(sec) {
	sec = sec | 0;
	var hours   = Math.floor(sec / 3600);
	var minutes = Math.floor((sec - (hours * 3600)) / 60);
	var seconds = sec - (hours * 3600) - (minutes * 60);

	if (hours   < 10) {hours   = "0"+hours;}
	if (minutes < 10) {minutes = "0"+minutes;}
	if (seconds < 10) {seconds = "0"+seconds;}
	var time    = hours+':'+minutes+':'+seconds;
	return time;
}

/** Populate violation for selected trip
 *
 *  @param {String} id   tab id
 *  @param {int} ind   index of trip (0 <= ind < trips.length)
 */
function showViolations(id, ind) {
	
	cleanMap();
	
	var tab = LOCAL_STATE.tabs[id];
	var plot_index = tab.stat[tab.units.id].plot_trips[ind];
	var trip = tab.stat[tab.units.id].trips[plot_index];
	var sess = wialon.core.Session.getInstance();
	var ml = sess.getMessagesLoader();
	if (MAP) {
		ml.loadInterval(tab.units.id, trip.t1, trip.t2, 1, 1, 0xFFFFF,
			qx.lang.Function.bind(function(tab, plot_index, code, data){
				if (LOCAL_STATE.last_sel_tab == tab && LOCAL_STATE.last_flot_click == ind && !code) {
					var i = 0;
					for(i=0; i<MULTIPOLY.length; i++){
						if (MULTIPOLY[i]) {
							MAP.removeLayer(MULTIPOLY[i]);
						}
					}
					
					var multipoly = [[],[],[],[],[]], poly = [];
					var index = 0, cur = [], cur_index = null;
					i=0;
					while( i<data.messages.length ){
						if (data.messages[i].pos && data.messages[i].pos.x && data.messages[i].pos.y){
							index = getSpeedIndex(data.messages[i].pos.s);
							if (index != cur_index) {
								if (cur_index>=0 && cur.length) {
									cur.push(L.latLng(data.messages[i].pos.y, data.messages[i].pos.x));
									multipoly[cur_index].push(cur);
									cur = [];
								}
								cur_index = index;
							}
							cur.push(L.latLng(data.messages[i].pos.y, data.messages[i].pos.x));
							poly.push(L.latLng(data.messages[i].pos.y, data.messages[i].pos.x));
						}
						i++;
					}
					if (cur_index>=0 && cur.length) {
						multipoly[cur_index].push(cur);
					}
					
					var bounds = new L.LatLngBounds();
					for (i=0; i<multipoly.length; i++) {
						if (multipoly[i].length) {
							MULTIPOLY[i] = new L.MultiPolyline(multipoly[i], {
								color:LOCAL_STATE.speed_color[i],opacity:0.8,clickable:false,weight:6
							}).addTo(MAP);
							bounds.extend(MULTIPOLY[i].getBounds());
						}
					}
					if(!LOCAL_STATE.map_bounds.length){
						LOCAL_STATE.map_bounds = [
							[bounds.getNorth(), bounds.getEast()],
							[bounds.getSouth(), bounds.getWest()]
						];
						MAP.fitBounds(bounds, {padding:[10,10]});
					}
				}
			}, null, id, ind)
		);
	}
	var bounds = [];
	var template = _.template($("#viol-row").html());
	var html = [];
	var viol = getAllViolations(id, plot_index);
	var t = "";
	var m = null;
	
	if (viol.length === 0) {
		html.push("<tr class='no_violations'><td>" + $.localise.tr("No violations") + "</td></tr>");
	} else {
		var prev = [], dxy = 0, XY = 0.00001, text = "", pos = {};
		for (var i=0; i<viol.length; i++) {
			// position of current violation
			pos = {
				y: viol[i][3].y,
				x: viol[i][3].x
			};
			if (i > 0 && prev[0] == pos.y && prev[1][4] == viol[i].x)
				dxy++;
			else
				dxy = 0;
			// save previous point
			prev = [pos.y, pos.x];
			text = generateViolationLabel(viol[i]);
			t = wialon.util.DateTime.formatTime(viol[i][0].v, false, DATE_FORMAT);

			var type = "";
			if (LOCAL_STATE.violation_types[viol[i][2].v]) {
				type = LOCAL_STATE.violation_types[viol[i][2].v].cl;
			}

			var tmp = template({
				"id": id,
				"ind": i,
				"num": i+1,
				"time": t.replace("_", " "),
				"text": text,
				"type": type,
				"x": pos.x,
				"y": pos.y,
				"index": i,
				"penalty": viol[i][5].t
			});
			t = t.split("_");
			if (t.length==2)
				t = "<i><b>" + t[0] + "</b> " + t[1]+"</i>";
			else
				t = t.join(" ");
			m = L.marker([pos.y + dxy*XY, pos.x + dxy*XY],{riseOnHover: true, icon:
				new L.NumberedDivIcon({
					number: i + 1,
					iconUrl: "img/markers/" + type + ".png",
					iconSize: [30, 42],
					iconAnchor: [15, 42]
				})
			}).bindPopup(t + "<div class='" + type + "'>" + text + "</div>").addTo(MAP);
			m.viol = id+"_"+i;
			
			m.on("popupopen", highlightViolation);
			
			MARKERS.push(m);
			bounds.push([pos.y, pos.x]);
			html.push(tmp);
		}
	}
	
	LOCAL_STATE.map_bounds = bounds;
	if (bounds.length)
		MAP.fitBounds(bounds, {padding:[10,10]});
	
	$("#viol-table").html(html.join("")).parent().scrollTop();
	
	tab = LOCAL_STATE.tabs[id];
	trip = tab.stat[tab.units.id].trips[plot_index];
	var from_to = formatDateRange(
		wialon.util.DateTime.formatTime(trip.t1, false, DATE_FORMAT),
		wialon.util.DateTime.formatTime(trip.t2, false, DATE_FORMAT)
	);
	$("#viol-header").show().children("span").html(
		"<span class='label'>"+$.localise.tr("Violations of the trip")+"</span> <i>" + from_to + "</i>"
	);
}

/** Get color index to colorize track by speed
 *
 *  @param {String} speed   speed in kilometers
 */
function getSpeedIndex(speed){
	speed = (!speed || speed < 0) ? 0 : speed;
	if (MEASURE == 1) {
		speed = speed * KM2MI;
	}
	var index = null;
	for (var i=0; i<LOCAL_STATE.speed_limit.length-1; i++ ) {
		if (LOCAL_STATE.speed_limit[i]<=speed && speed<LOCAL_STATE.speed_limit[i+1]) {
			index = i;
			break;
		}
	}
	if (index === null && LOCAL_STATE.speed_limit[LOCAL_STATE.speed_limit.length-1]<=speed) {
		index = LOCAL_STATE.speed_limit.length-1;
	}
	return index;
}

/** Get label for violation
 *
 *  @param {object} viol   violation object
 *  @returns {String} pretty violation label
 */
function generateViolationLabel(viol){
	return getViolationText(viol) + " (<b>" + viol[3].t + "</b>)";
}

/** Delete markers and polylines from map
 */
function cleanMap(){
	LOCAL_STATE.map_bounds = [];
	var i=0;
	for(i=0; i<MARKERS.length; i++)
		MAP.removeLayer(MARKERS[i]);
	MARKERS = [];
	for(i=0; i<MULTIPOLY.length; i++){
		if (MULTIPOLY[i]) {
			MAP.removeLayer(MULTIPOLY[i]);
		}
		MULTIPOLY[i] = null;
	}
}

/** Highlight violation marker and row in table, scroll table if needed
 */
function highlightViolation(){
	if (this._popup._isOpen) {
		var t = $("#viol-table tr.selected");
		if (t.size()) {
			t.removeClass("selected");
			$(MARKERS[t.data("index")]._icon).children(".number").removeClass("selected");
		}
		$("#viol_"+this.viol).addClass("selected");
		$(MARKERS[$("#viol_"+this.viol).data("index")]._icon).children(".number").addClass("selected");
		var viol = this.viol.split("_");
		var num = parseInt(viol[viol.length-1],10);
		var cont = $(".viol-table-container");
		var scroll = cont.scrollTop();
		
		if(num * 25 < scroll)
			cont.animate({
				scrollTop: 25 * num
			},200);
		else if (scroll + cont.height() < (num+1) * 25)
			cont.animate({
				scrollTop: (num+1) * 25 - cont.height()
			},200);
	}
}

/** Construct and return array of violations
 *  Concat accel, brake and turns violations and sort them
 *
 *  @param {String} id   tab id
 *  @param {int} ind   index of trip (0 <= ind < trips.length)
 *  @returns {Array} 3 types of violation together, sorted by time
 */
function getAllViolations(id, ind){
	var tab_info = id.split("_");
	if(tab_info.length != 4)
		return [];
	var viol = LOCAL_STATE.tabs[id].stat[tab_info[2]].trips[ind].viol;
	var all_v = [];
	for (var i in viol) {
		all_v = all_v.concat(viol[i]);
	}
	wialon.util.Helper.sortItems(all_v, function(a) {return "" + a[0].v;});
	return all_v;
}

/** Generate violation text (using underscore.memorize)
 *
 *  @param {Object} viol   violation
 *  @returns {String} translated violation text
 */
var getViolationText = function (viol) {
	var txt = "Unknown";
	if (viol[2].t) {
		txt = viol[2].t;
	} else if (LOCAL_STATE.violation_types[viol[2].v]) {
		txt = $.localise.tr(LOCAL_STATE.violation_types[viol[2].v].name);
	}
	return txt;
};

/** Find unit in cache
 *
 *  @param {int} id   unit id
 *  @returns {avl_unit || null} wialon unit object
 */
function findUnit(id){
	if(LOCAL_STATE.item_cache.avl_unit){
		var len = LOCAL_STATE.item_cache.avl_unit.length;
		for (var i=0; i<len; i++)
			if(LOCAL_STATE.item_cache.avl_unit[i].getId()==id)
				return LOCAL_STATE.item_cache.avl_unit[i];
	}
	return null;
}

/** Find unit on tab
 *
 *  @param {object} tab   internal tab object (@see LOCAL_STATE.tabs)
 *  @param {int} id   unit id
 *  @returns {object} internal unit object
 */
function findUnitOnTab(tab, id){
	if (tab){
		if(tab.tab_type)
			return tab.units.id==id ? tab.units : null;
		else
			for (var i=0; i<tab.units.length && tab; i++)
				if(tab.units[i].id==id)
					return tab.units[i];
	}
	return null;
}

/** Get unique color for new tab
 *
 *  @returns {int} index of color (@see LOCAL_STATE.colors)
 */
function getColor(){
	for (var ind in LOCAL_STATE.colors)
		if(ind>0 && !(LOCAL_STATE.color_in_use & ind)){
			LOCAL_STATE.color_in_use = LOCAL_STATE.color_in_use | ind;
			return ind;
		}
	return 0;
}

/** Save/remove unit id to cookie
 *
 *  @param {int} id   unit id
 *  @param {bool} remove   true - remove from cookie
 */
function toggleCookie(id, remove){
	var ids = $.cookie("idrive");
	ids = ids ? ids.split(",") : [];
	var ind = ids.indexOf(id);
	var update = false;
	if(remove) {
		if (ind != -1){
			ids.splice(ind, 1);
			update = true;
		}
	} else if (ind == -1) {
		ids.push(id);
		update = true;
	}
	if (update)
		$.cookie("idrive", ids.join(","), {expires: 300});
}

/** Sort units on tab
 *
 *  @param {object} tab   internal tab object (@see LOCAL_STATE.tabs)
 */
function sortUnits(tab) {
	var sort = Math.abs(tab.sort);
	switch (sort) {
		case 1: // sort by unit name
			tab.units.sort(sortBy(
				function(x){ var u = findUnit(x); return u ? u.getName().toUpperCase() : ""; },
				"id", tab.sort>0)
			);
		break;
		case 2: //sort by rate
			tab.units.sort(sortBy(
				function(x){
					return tab.stat[x] && tab.stat[x].rate!==null ? tab.stat[x].rate : -1; },
				"id", tab.sort>0)
			);
		break;
		case 3: //sort by mileage
			tab.units.sort(sortBy(
				function(x){ return tab.stat[x] && tab.stat[x].mileage ? tab.stat[x].mileage : -1; },
				"id", tab.sort>0)
			);
		break;
		case 4: //sort by trips count
			tab.units.sort(sortBy(
				function(x){ return tab.stat[x] && tab.stat[x].trips.length ? tab.stat[x].trips.length : -1; },
				"id", tab.sort>0)
			);
		break;
		case 5: // sort by duration
			tab.units.sort(sortBy(
				function(x){ return tab.stat[x] && tab.stat[x].duration ? tab.stat[x].duration : -1; },
				"id", tab.sort>0)
			);
		break;
		case 6: // sort by violations count
			tab.units.sort(sortBy(
				function(x){ return tab.stat[x] && tab.stat[x].violations_count ? tab.stat[x].violations_count : -1; },
				"id", tab.sort>0)
			);
		break;
	}
}

/** Helper for sort by object.field
 */
function sortBy(getter, field, reverse){
	var key = function(x){ return getter(x[field]); };
	return function (a,b) {
		var A = key(a), B = key(b);
		return ((A < B) ? -1 : (A > B) ? +1 : 0) * [-1,1][+!!reverse];
	};
}

/** Add new tab
 *
 *  @param {Sring} tab_id   tab id
 */
function addTab(tab_id) {
	var tab_info = tab_id.split("_");
	if ( tab_info[0]!="tab" || (tab_info.length!=2 && tab_info.length!=4) )
		return;
	
	var parent_tab = "";
	if (tab_info.length == 4)
		parent_tab = "tab_"+tab_info[1];
	
	var tab = LOCAL_STATE.tabs[tab_id];
	if (!tab){
		var obj = {stat:{}};
		obj.tab_type = tab_info.length == 4 ? 1 : 0; // 0 - Statistic, 1 - Unit
		var unit = null;
		if (obj.tab_type) {
			// unit tab
			var tab_unit = findUnitOnTab(LOCAL_STATE.tabs[parent_tab], tab_info[2]);
			unit = findUnit(tab_info[2]);
			if (!unit)
				return;
			obj.units = {};
			obj.units.id = tab_info[2];
			obj.units.xhr = tab_unit ? tab_unit.xhr : null;
			obj.stat[tab_info[2]] = clone(LOCAL_STATE.tabs[parent_tab].stat[tab_info[2]]);
			obj.name = unit.getName();
			obj.time_type = LOCAL_STATE.tabs[parent_tab].time_type;
			obj.time_from = LOCAL_STATE.tabs[parent_tab].time_from;
			obj.time_to = LOCAL_STATE.tabs[parent_tab].time_to;
			obj.color = LOCAL_STATE.tabs[parent_tab].color;
			obj.parent = parent_tab;
		} else {
			// statistic tab
			obj.units = [];
			obj.name = "";
			obj.time_type = $("#dateinterval").intervalWialon("type");
			var interval = get_time_from_input();
			obj.time_from = interval[0];
			obj.time_to = interval[1];
			obj.color = getColor();
			obj.sort = 0;
		}
		LOCAL_STATE.tabs[tab_id] = obj;
		
		var template = _.template($("#item-tab-template").html());
		
		var tmp = template({
			"id": tab_id,
			"cls": parent_tab ? parent_tab : tab_id+" limited-tab",
			"name": LOCAL_STATE.tabs[tab_id].name,
			"title": LOCAL_STATE.tabs[tab_id].name,
			"close": tab_id === "tab_0" ? false : true,
			"color": LOCAL_STATE.colors[obj.color],
			"tab_type": obj.tab_type,
			"img": unit ? unit.getIconUrl(16) : false
		});
		
		if ($("#tabs ."+(parent_tab ? parent_tab : tab_id)).size()){
			$("#tabs ."+(parent_tab ? parent_tab : tab_id)).last().parent().after(tmp);
		} else {
			$("#tabs .add-tab-container").before(tmp);
		}
		$("#footer .scroll").resize();
	}
	switchTab(tab_id);
}

/** Switch to tab and change whole page content
 *
 *  @param {Sring} tab_id   tab id
 */
function switchTab(tab_id){
	var old_tab = LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab];
	var tab = LOCAL_STATE.tabs[tab_id];
	if (LOCAL_STATE.last_sel_tab == tab_id)
		return false;
	
	if(LOCAL_STATE.last_sel_tab)
		$("#"+LOCAL_STATE.last_sel_tab).removeClass("active").parent().removeClass("item-selected");
	var tab_html = $("#"+tab_id);
	var footer = $("#footer .scroll");
	tab_html.addClass("active").parent().addClass("item-selected");
	var off = tab_html.offset();
	var scroll = footer.scrollLeft();
	if( scroll > off.left - 20 ){
		footer.scrollLeft( scroll + off.left - 20 );
	} else if ( footer.width() < off.left + tab_html.parent().width() - 20 ) {
		footer.scrollLeft( scroll + off.left + tab_html.parent().width() - 20 - footer.width() );
	}
	
	if(old_tab && old_tab.tab_type)
		$("#"+LOCAL_STATE.last_sel_tab).parent().css({
			"border-top-color": LOCAL_STATE.colors[old_tab.color],
			"border-bottom-color": ""
		});
	
	if(tab.tab_type){
		tab_html.parent().css({"border-bottom-color":LOCAL_STATE.colors[tab.color],"border-top-color":""});
		var ka = tab.stat[tab.units.id] && tab.stat[tab.units.id].rate ? tab.stat[tab.units.id].rate : "";
		$("#item-info-block").show().children(".rate").html(ka);
	} else {
		$("#item-info-block").hide();
	}
	
	LOCAL_STATE.tab_history.push(tab_id);
	
	LOCAL_STATE.last_sel_tab = tab_id;
	LOCAL_STATE.last_flot_click = null;
	PLOT.unhighlight();
	$("#dateinterval").intervalWialon("set", tab.time_type, [tab.time_from, tab.time_to], true);
	activateTimeTemplate(parseInt(tab.time_type, 10));
	
	if(tab.tab_type) {
		$("#stat-tab").css("display","none");
		$("#item-tab").css("display","block");
		PLOT.resize();
		if(tab.units.xhr)
			$("#overlay-tab").show();
		else
			$("#overlay-tab").hide();
		if (!MAP)
			initMap();
		showStatistic(tab_id);
		MAP.invalidateSize();
	} else {
		$("#stat-tab").css("display","block");
		$("#item-tab").css("display","none");
		$("#overlay-tab").hide();
		showMenu(tab_id);
	}
	
	return false;
}

/** Close tab
 *
 *  @param {Sring} tab_id   tab id
 */
function closeTab(tab_id){
	var cls = tab_id.split("_");
	if (cls.length == 2)
		cls = tab_id;
	else
		cls = "";
	var tab = LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab];
	if (LOCAL_STATE.last_sel_tab == tab_id || (cls && tab.parent==cls)) {
		var history = "tab_0";
		for (var i=LOCAL_STATE.tab_history.length-1, t=""; i >= 0; i--) {
			t = LOCAL_STATE.tab_history[i];
			if (t in LOCAL_STATE.tabs) {
				if (t == tab_id || (cls && LOCAL_STATE.tabs[t].parent==cls)) {
					continue;
				} else {
					history = t;
					break;
				}
			}
		}
		switchTab(history);
		LOCAL_STATE.last_sel_tab = history;
	}
	if (LOCAL_STATE.tabs[tab_id]) {
		if (cls) {
			LOCAL_STATE.color_in_use = LOCAL_STATE.color_in_use ^ LOCAL_STATE.tabs[tab_id].color;
		}

		for (var j in LOCAL_STATE.tabs) {
			// delete tab and child tabs from JS storage
			if (j == tab_id || LOCAL_STATE.tabs[j].parent == tab_id) {
				LOCAL_STATE.tabs[j] = null;
				delete LOCAL_STATE.tabs[j];
			}
		}
	}
	// remove html tabs
	if (cls) {
		$("#tabs ."+cls).parent().remove();
	} else {
		$("#"+tab_id).parent().remove();
	}
	$("#footer .scroll").resize();
	return false;
}

/** Format abs time to local time
 *
 *  @param {int} abs_time   UNIX time UTC
 *  @param {int} tz   timezone offset
 *  @param {int} dst   DST
 *  @returns {int} local time
 */
function get_user_time(abs_time, tz, dst) {
	if(typeof wialon == "undefined")
		return abs_time;
	var t = abs_time - get_local_timezone() + tz + dst;
		return t;
}

/** Get local timezone
 *
 *  @returns {int} local timezone
 */
function get_local_timezone() {
	var rightNow = new Date();
	var jan1 = new Date(rightNow.getFullYear(), 0, 1, 0, 0, 0, 0);  // jan 1st
	var june1 = new Date(rightNow.getFullYear(), 6, 1, 0, 0, 0, 0); // june 1st
	var temp = jan1.toGMTString();
	var jan2 = new Date(temp.substring(0, temp.lastIndexOf(" ")-1));
	temp = june1.toGMTString();
	var june2 = new Date(temp.substring(0, temp.lastIndexOf(" ")-1));
	var std_time_offset = ((jan1 - jan2) / (1000 * 60 * 60));
	var daylight_time_offset = ((june1 - june2) / (1000 * 60 * 60));
	var dst;
	if (std_time_offset == daylight_time_offset) {
		dst = "0"; // daylight savings time is NOT observed
	} else {
		// positive is southern, negative is northern hemisphere
		var hemisphere = std_time_offset - daylight_time_offset;
		if (hemisphere >= 0)
			std_time_offset = daylight_time_offset;
		dst = "1"; // daylight savings time is observed
	}
	return parseInt(std_time_offset*3600,10);
}

/** Make Date and time format compatible with SDK timeFormat
 *
 *  @param {String} date   string representation of date
 *  @param {String} time   string representation of time
 *  @returns {String} string representation of date-time
 */
function rightFormat(date, time){
	date = "" + date;
	return convertDateFormat(date) + "_" + time;
}

/** Convert date format to Wialon compatible
 *
 *  @param {String} format   string representation of date
 *  @param {String} mode   convert direction
 *  @return {String} converted format
 */
function convertDateFormat(format, mode) {
	var i = 0;
	var tokens = {
		"MM": "%B",// The full month name. ("January" to "December")
		"M": "%b",// Abbreviated month name. ("Jan" to "Dec")
		"DD": "%A",// The full day name. ("Monday" to "Sunday")
		"D": "%a",// Abbreviated day name. ("Mon" to "Sun")
		"dd": "%E",// The day of the month with leading zero if required. ("01" to "31")
		"d": "%e",// The day of the month between 1 and 31. ("1" to "31")
		"yy": "%Y",// The full four digit year. ("1999" or "2008")
		"y": "%y"// The year as a two-digit number. ("99" or "08")
	};
	if (!mode) {
		for (i in tokens) {
			format = format.replace(new RegExp(i, "g"), tokens[i]);
		}
		// fix for 'mm-dd-yy' formatter
		var old = format;
		format = format.replace(new RegExp("mm", "g"), "%m");
		if ((old == format) || (format.indexOf("m") != format.indexOf("%m") + 1)) {
			format = format.replace(new RegExp("m", "g"), "%l");
		}
	} else {
		tokens.mm = "%m";
		tokens.m = "%l";
		for (i in tokens) {
			format = format.replace(new RegExp(tokens[i], "g"), i);
		}
	}
	return format;
}

/** Format from-to interval to pretty string, skipping same date and hide time if needed
 *
 *  @param {String} from   string representation of from date
 *  @param {String} to   string representation of to date
 *  @param {bool} date_only   if needed only date (without time)
 *  @returns {String} pretty string representation of interval
 */
function formatDateRange(from, to, date_only){
	var f = (""+from).split("_"), t = (""+to).split("_");
	if (f.length==2 && t.length==2) {
		if (f[0]==t[0])
			return "<i><b>" + f[0] + "</b> " + (date_only ? "" : f[1] + " &ndash; " + t[1]) + "</i>";
		else
			return "<i><b>" + f[0] + "</b> " + (date_only ? "" : f[1]) + " &ndash; <b>" +
				t[0] + "</b> " +(date_only ? "" : t[1]) + "</i>";
	} else
		return "<i>" + from + " &ndash; " + to + "</i>";
}

/** Get time from the user input
 *
 *  @param {bool} is_send   if interval will be send directly to Wialon
 *  @returns {Array} [from, to] interval
 */
function get_time_from_input (is_send) {
	return $("#dateinterval").intervalWialon("get", is_send);
}

/** Clone object
 *
 * @param {object} obj   object to be cloned
 * @returns {object} clone of input object
 */
function clone(obj) {
	var target = {};
	for (var i in obj) {
		if (obj.hasOwnProperty(i)) {
			target[i] = obj[i];
		}
	}
	return target;
}
