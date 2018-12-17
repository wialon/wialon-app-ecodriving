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
		name: "Reckless driving",
		cl: "hd"
	}],
	// current user can exec reports
	canExec: true,
	// units list sort direction
	sort: 0,
	// view mode (units or groups)
	mode: 0,
	// view mode (units - 0, drivers - 1)
	view: 0
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
var get_url_parameter = _.memoize(function (name,def) {
	if (!name) {
		return null;
	}
	var pairs = document.location.search.substr(1).split("&");
	for (var i = 0; i < pairs.length; i++) {
		var pair = pairs[i].split("=");
		if (decodeURIComponent(pair[0]) === name) {
			return decodeURIComponent(pair[1]);
		}
	}
	return def || null;
});

/** Init Wialon SDK (callback of load script wialon.js)
 */
function init_sdk() {
	var branch = get_url_parameter("b","master");
	var url = get_url_parameter("baseUrl",(branch=="develop"?"https://dev-api.wialon.com":"https://hst-api.wialon.com"));
	if (!url)
		url = get_url_parameter("hostUrl","https://hosting.wialon.com");
	if (!url)
		return;

	var user = get_url_parameter("user") || "";
	var sid = get_url_parameter("sid");
	var authHash = get_url_parameter("authHash");

	wialon.core.Session.getInstance().initSession(url, "gapp_eco_driving");
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
	DATE_FORMAT = 'dd.MM.yyyy_HH:mm:ss';
	if (regional) {
		$.datepicker.setDefaults(regional);
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

    updateLocale();

    var u = wialon.core.Session.getInstance().getCurrUser();
    u.addListener("changeCustomProperty", qx.lang.Function.bind(updateLocale, this), this);

    function get_tz_dst_offset () {
        var tz = -(new Date()).getTimezoneOffset() * 60;
        if (!user)
            return tz;
        return parseInt(user.getCustomProperty("tz", tz));
    }

    function updateLocale () {
        var locale = {};
        locale.formatDate = wialon.util.DateTime.convertFormat(DATE_FORMAT);
        var mu = user.getMeasureUnits();
        switch (mu) {
            case 0:
                locale.flags = 0;
                break;
            case 1:
                locale.flags = wialon.render.Renderer.OptionalFlag.usMetrics;
                break;
            case 2:
                locale.flags = wialon.render.Renderer.OptionalFlag.imMetrics;
                break;
            case 3:
                locale.flags = 0;
                break;
        }
        locale.flags |= wialon.render.Renderer.OptionalFlag.skipBlankTiles || 0;
        wialon.core.Session.getInstance().getRenderer().setLocale(get_tz_dst_offset(), LANG, locale, null);

    }

	// get user locale
	user.getLocale(function(code, locale){
		if (code) {
			return;
		}

		var nowUnix = wialon.core.Session.getInstance().getServerTime();

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
			tzOffset: wialon.util.DateTime.getTimezoneOffset() + wialon.util.DateTime.getDSTOffset( nowUnix ),
			now: nowUnix,
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
			} else {
                options.dateFormat = "dd.MM.yyyy";
                DATE_FORMAT = "dd.MM.yyyy_HH:mm:ss";
                FIRST_DAY = 1;
                options.firstDay = 1;
            }
		}

		$("#dateinterval").intervalWialon(options);
		var html = '<div id="drivers_switcher" class="iw-select">' +
			'       <button data="0" type="button" class="iw-period-btn mode_0 active">' + $.localise.tr("Units") + '</button>' +
			'       <button data="1" type="button" class="iw-period-btn mode_1">' + $.localise.tr("Drivers") + '</button>' +
			'   </div>';
		$("#mode_switcher").html(html);

	});

	MEASURE = user.getMeasureUnits();
	if (MEASURE == 1 || MEASURE == 2) {
		$("#sort_3").html($.localise.tr("Mileage") + ", " + $.localise.tr("mi"));
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

	wialon.core.Session.getInstance().loadLibrary("resourceDrivers");
	wialon.core.Session.getInstance().loadLibrary("resourceDriverGroups");

	changeType("avl_unit");
	searchItems(function(){}, 1, 1, "avl_unit_group");

	wialon.core.Remote.getInstance().finishBatch(function(){
		var fakeGroup = {
			units: [],
			getId: function() {
				return 1;
			},
			getName: function() {
				return $.localise.tr("Units outside groups");
			},
			getType: function() {
				return "avl_unit_group"
			},
			getUnits: function() {
				return this.units;
			}
		};
		// get all units outside group
		var ids = {};
		var units = LOCAL_STATE.item_cache.avl_unit || [];
		for (var i = 0; i < units.length; i++) {
			ids[units[i].getId()] = 0;
		}
		var groups = LOCAL_STATE.item_cache.avl_unit_group || [];
		for (var i = 0; i < groups.length; i++) {
			var u = groups[i].getUnits();
			for (var k = 0; k < u.length; k++) {
				if (u[k] in ids) {
					delete ids[u[k]];
				}
			}
		}

		for (var id in ids) {
			fakeGroup.units.push(id);
		}
		if (fakeGroup.units.length) {
			if ("avl_unit_group" in LOCAL_STATE.item_cache) {
				LOCAL_STATE.item_cache.avl_unit_group.push(fakeGroup);
			} else {
				LOCAL_STATE.item_cache.avl_unit_group = [fakeGroup];
			}
		}
	}, "initBatch");

	// kill session on page refresh
	window.onbeforeunload = function () {
		wialon.core.Session.getInstance().logout();
	};
}

function searchDrivers (cb) {


	wialon.core.Remote.getInstance().startBatch("searchDriversBatch");

	var lflags = wialon.item.Item.dataFlag.base |
		wialon.item.Item.dataFlag.image |
		wialon.item.Resource.dataFlag.drivers |
		wialon.item.Resource.dataFlag.driverGroups |
		wialon.item.Resource.dataFlag.reports;



	searchItems(qx.lang.Function.bind(function (items) {
		var html = "",
			litems = {},
			type = "avl_driver",
			res,
			drivers,
			groups;

		LOCAL_STATE.resources = {};
		LOCAL_STATE.drivers_cache = {};

		if (type === "avl_driver") {
			for (var i = 0, len = items.length; i < len; i++) {
				res = items[i];

				if (!res) continue;
				drivers = items[i].getDrivers();

				LOCAL_STATE.resources[res.getId()] = res;

				if ((!drivers) || $.isEmptyObject(drivers)) continue;
				litems[res.getId()] = drivers;
				for (var did in drivers) {
					var obj = drivers[did];
					if (!obj)
						continue;
					obj._resid = res.getId();
					obj._res = res;
					LOCAL_STATE.drivers_cache[res.getId() + "_" + did] = obj;
				}
			}
			LOCAL_STATE.item_cache["avl_driver"] = litems;
		}
	}, this), lflags, 0, "avl_driver");

	searchItems(qx.lang.Function.bind(function (items) {
		var litems = {},
			res,
			groups,
			gr = null,
			drivers = null,
			d = null;

		for (var i = 0, len = items.length; i < len; i++) {
			res = items[i];
			if (!res) continue;

			LOCAL_STATE.resources[res.getId()] = res;

			groups = res.getDriversGroups();
			if ((!groups) || $.isEmptyObject(groups))
				continue;

			litems[res.getId()] = groups;

			var tmp_arr = Object.keys(LOCAL_STATE.drivers_cache);

			for (var gid in groups) {
				gr = groups[gid];
				drivers = gr.drs;

				gr.id = res.getId() + "_" + gr.id;

				for (var did in drivers) {
					d = drivers[did];
					if (!d) continue;
					var indx = tmp_arr.indexOf(res.getId() + "_" + d);
					if (indx !== -1)
						tmp_arr.splice(indx, 1);
				}
			}

			LOCAL_STATE.item_cache["avl_drivers_group"] = litems;

			var fakeGroup = {
				drs: [],
				id: "0_0",
				n: $.localise.tr("Drivers outside groups")
			};
			for (var id in tmp_arr) {
				fakeGroup.drs.push( LOCAL_STATE.drivers_cache[ tmp_arr[id] ] );
			}
			if (fakeGroup.drs.length) {
				if ("avl_drivers_group" in LOCAL_STATE.item_cache) {
					LOCAL_STATE.item_cache.avl_drivers_group[0] = {
						0 :fakeGroup
					};
				} else {
					LOCAL_STATE.item_cache.avl_drivers_group[0] = {
						0 :fakeGroup
					};
				}
			}
		}
	}, this), lflags, 0, "avl_drivers_group");

	wialon.core.Remote.getInstance().finishBatch(cb, "searchDriversBatch");
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

	if (type === 'avl_resorce') {
		flags |= 0x00000100;
		flags |= 0x00008000;
	}

	searchItems(
		qx.lang.Function.bind(function (items) {
			if (type == "avl_unit") {
				// count of units with settings
				var okUnits = 0;

				wialon.core.Remote.getInstance().startBatch("driveRankSettings");

				// check if can exec report
				wialon.core.Session.getInstance().searchItem(user.getAccountId(), 0x1, function(code, data) {
					if (code || !data || !(data.getUserAccess() & wialon.item.Resource.accessFlag.viewReports)) {
						LOCAL_STATE.canExec = false;
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

						if (code === 0 && hasDriveRankSettings(data)) {
								unit.driveRankSettings = true;
								okUnits++;
						}
					}, this, items[u]));
				}
				wialon.core.Remote.getInstance().finishBatch(function () {
					// sort by name
					sortListItems(items);

					// change phrases if no configured units
					if (okUnits === 0) {
						$("#add-unit").html($.localise.tr("You have no units with adjusted driving criteria."));
					}

					$("#items .list").html(fillListWithItems(true));
					addTab("tab_"+LOCAL_STATE.tab_index++);

					if (LOCAL_STATE.canExec) {
						var ids = getStorageItem("idrive");
						if (typeof ids === "undefined"){
							// toDo: first start
						} else {
							ids = ids ? ids.split(",") : [];
							for (var i = 0; i < ids.length; i++) {
								toggleUnit(ids[i], $(".item_"+ids[i]));
							}
						}
					}
				}, "driveRankSettings");
			}
		}, this),
		flags
	);
}

/** Sort units
 */
function sortListItems(items) {
	wialon.util.Helper.sortItems(items, null, null, LOCAL_STATE.sort ? 1 : 0);
}

/** Check if driveRankSettings not empty
 *
 * @param {Object} data   driveRank unit settings
 * @returns {bool}
 */
function hasDriveRankSettings(data) {
	return !("error" in data || $.isEmptyObject(data) || (_.keys(data).length == 1 && 'global' in data));
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

	if (type === "avl_driver" || type === "avl_drivers_group")
		type = "avl_resource";

	if (!force && LOCAL_STATE.item_cache[type]){
		callback(LOCAL_STATE.item_cache[type]);
	} else {
		var spec = {
			itemsType: type,
			propName: "sys_name",
			propValueMask: "*",
			sortType: "sys_name"
		};
		wialon.core.Session.getInstance().searchItems(spec, true, flags, 0, 0,
			qx.lang.Function.bind(function (cb, code, data) {
				if (code === 0 && data) {
					LOCAL_STATE.item_cache[type] = data.items;
					cb(LOCAL_STATE.item_cache[type]);
				}
			}, this, callback)
		);
	}
}

/** Construct html list of found units
 *
 *  @param {Boolean} refresh   async icons loading
 *  @param {Array} active   list of active ids
 *  @returns {String} html list of items
 */
function fillListWithItems(refresh, active){
	active = active || [];
	var html = "";
	var cache = refresh ? [] : null;
	var $items = $("#items");
	var mask = $(".mask", $items).val();
	var groups = LOCAL_STATE.item_cache['avl_unit_group'];

	var template = _.template($("#item-template").html());
	var groupTemplate = _.template($("#item-group-template").html());
	if (LOCAL_STATE.mode == 0) {
		var units = LOCAL_STATE.item_cache['avl_unit'];
		units = units.filter(function(u) {
			return checkName(u, mask);
		});

		// unit
		html = generateUnitsList(template, units, active, mask, cache);
	} else {
		var items = null,
			id = null,
			group = null;
		// unit groups
		for (var i = 0; i < groups.length; i++) {
			group = groups[i];
			id = group.getId();
			if (checkName(group, mask)) {
				items = getGroupUnits(group, "");
			} else {
				items = getGroupUnits(group, mask);
			}

			if (group.drs) {
				if (checkName(group.n, mask)) {
					items = getGroupDrivers(group, "");
				} else {
					items = getGroupDrivers(group, mask);
				}
				var info = getUnitGroupInfo(items, active);
				var cls = "group item_g_" + id;
				if (items.length && info.active && info.settings) {
					cls += " active";
				}
			}

			// skip filtred
			if (mask.length && !items.length) {
				continue;
			}
			var info = getUnitGroupInfo(getGroupUnits(group), active);
			var cls = "group item_" + id;
			if (items.length && info.active && info.settings) {
				cls += " active";
			}
			cls += " item" + (items.length && info.settings ? "" : "-inactive");

			// construct html
			html += groupTemplate({
				"id": id,
				"cls": cls,
				"value": group.getName() + " (" + group.getUnits().length + ")",
				"disabled": LOCAL_STATE.canExec
			});

			var style = "";
			if (!mask)
				style = "display:none;";
			// unit group block
			html += "<div class='units' id='unit_group_" + id + "' style='" + style + "' >" +
				generateUnitsList(template, items, active, mask, cache) +
			"</div>";
		}
	}

	if (refresh) {
		// assync icons loading
		var ID = setInterval(function(){
			if(cache.length){
				var j = 0, tmp = [];
				while(cache.length && (j++)<10){
					tmp = cache.shift();
					$(tmp[0] + " .item-img img", $items).attr("src", tmp[1]);
				}
			} else {
				clearInterval(ID);
			}
		}, 150);
	}

	if (html == "") {
		html = "<div class='no-result'>" + $.localise.tr("No items match the specified criteria") + "</div>";
	}

	return html;
}

function generateDriversList (template, items, active, mask, cache) {

	var template = _.template($("#driver-template").html());
	var html = "";
	var id,
		disabled,
		cls,
		img,
		item;

	for (var i = 0, len = items.length; i < len; i++) {
		item = items[i];
		if (!item) continue;

		id = item._res.getId() + "_" + item.id;

		cls = [
			"item_" + id,
			"item"
		];

		if (active.indexOf("" + id) > -1) {
			cls.push("active");
		}

		html += template({
			img: item.r ? item._res.getDriverImageUrl(item, 16) : "./img/photo-no.png",
			key: id,
			value: item.n,
			cls: cls.join(" ")
		});
		// add icon to cache for async loading
		if (cache) {
			cache.push([".item_" + id, img]);
		}
	}
	return html;
}
///
function fillListOfDrivers (objects, active) {
	var temp = [];
	var template = _.template($("#driver-template").html());
	var group_template = _.template($("#driver-group-template").html());
	var $items = $("#items");
	var mask = $(".mask", $items).val();
	var html = [];

	/// list without groups
	if (LOCAL_STATE.mode == 0) {
		for (var resid in objects) {
			var objs = objects[resid];
			if (resid == 0) {
				objs = objects[resid].drivers;
			}
			if (!objs) {
				continue;
			}
			for (var objid in objs) {
				var obj = objs[objid];
				if (!obj) continue;

				if (resid != 0)
					obj._resid = resid;

				if (checkName(obj, mask)) {
					temp.push(obj);
				}
			}
		}

		var temp = wialon.util.Helper.sortItems(temp, function (item) {
			return item['n'].toLowerCase();
		}, null, LOCAL_STATE.sort ? 1 : 0);

		for (var i = 0, len = temp.length; i < len; i++) {
			var res = LOCAL_STATE.resources[parseInt(temp[i]._resid)];
			var cls = [
				"item_" + temp[i]._resid + "_" + temp[i].id,
				"item"
			];

			if (active.indexOf("" + temp[i]._resid + "_" + temp[i].id) > -1) {
				cls.push("active");
			}

			var tmp = template({
				img: temp[i].r ? res.getDriverImageUrl(temp[i], 16) : "./img/photo-no.png",
				key: temp[i]._resid + "_" + temp[i].id,
				value: temp[i].n,
				cls: cls.join(" ")
			});
			html.push(tmp);
		}

		html = html.join("");
	} else {
		var groups = [],
			res = null,
			res_id = null,
			group = null;


		for (var p in objects) {
			res_id = p;
			res = LOCAL_STATE.resources[parseInt(res_id)];

			for (var o in objects[p]) {
				group = objects[p][o];
				if (group.id !== "0_0") {
					group._resid = p;
					group._res = res;
				}
				groups.push(group);
			}
		}

		var groups = wialon.util.Helper.sortItems(groups, function (item) {
			return item['n'].toLowerCase();
		}, null, LOCAL_STATE.sort ? 1 : 0);

		var group_flag = 0;
		for (var o in groups) {
			group = groups[o];
			var id = group.id;
			var drivers = [];
			var drivers_out = [];

			drivers = group.drs;
			group_flag = 0;
			if (group && checkName(group, mask)) {
				group_flag = 1;
			}
			for (var d in drivers) {
				var driver = drivers[d];
				if (typeof driver == "number") {
					driver = group._res.getDriver(driver);
					driver._res = group._res;
				}
				if (group_flag === 1) {
					drivers_out.push(driver);
				} else if (checkName(driver, mask)) {
					drivers_out.push(driver);
				}
			}

			// skip filtred
			if (mask.length && !drivers_out.length) {
				continue;
			}

			var info = getDriverGroupInfo(getGroupDrivers(group), active);
			var cls = "group item_g_" + id;
			if (drivers_out.length && info.active) {
				cls += " active";
			}
			cls += " item" + (drivers_out.length ? "" : "-inactive");

			// construct html
			html += group_template({
				id: id,
				cls: cls,
				value: group.n + " (" + group.drs.length + ")",
				disabled: LOCAL_STATE.canExec
			});

			var style = "";
			if (!mask)
				style = "display:none;";
			// unit group block
			html += "<div class='units' id='unit_group_" + id + "' style='" + style + "' >" +
				generateDriversList(template, drivers_out, active, mask, []) +
				"</div>";
		}
	}
	if (html == "") {
		html = "<div class='no-result'>" + $.localise.tr("No items match the specified criteria") + "</div>";
	}

	return html;
}

/** Generate HTML list of units
 */
function generateUnitsList(template, units, active, mask, cache) {
	var html = "";
	for (var i = 0, len = units.length; i < len; i++) {
		var unit = units[i];
		if (!unit) {
			continue;
		}

		var id = unit.getId();
		var disabled = unit.driveRankSettings && LOCAL_STATE.canExec;
		var cls = [
			"item_" + id,
			"item" + (disabled ? " " : "-inactive ")
		];
		if (active.indexOf("" + id) > -1) {
			cls.push("active");
		}

		html += template({
			"id": id,
			"cls": cls.join(" "),
			"img": cache ? "" : unit.getIconUrl(16),
			"value": unit.getName(),
			"disabled": disabled
		});
		// add icon to cache for async loading
		if (cache) {
			cache.push([".item_" + id, unit.getIconUrl(16)]);
		}
	}

	return html;
}


/** Onload translation
 *  Translate text on page
 */
function ltranslate () {
	var title = decodeURIComponent(APP_CONFIG.alias || "Eco Driving");
	$("#header .app-name").html(title);
	document.title = title;

	$("#sort_1").html($.localise.tr("Unit"));
	$("#sort_2").html($.localise.tr("Penalty"));
	$("#sort_3").html($.localise.tr("Mileage") + ", " + $.localise.tr("km"));
	$("#sort_5").html($.localise.tr("Duration"));
	$("#sort_4").html($.localise.tr("Trips"));
	$("#sort_6").html($.localise.tr("Violations"));
	$("#sort_7").html($.localise.tr("Rank"));

	$("#add-unit").html($.localise.tr("Add units from the list on the left"));
	$("#all-stat .delete-all-button").attr('title', $.localise.tr("Clear list") );

	$("#tabs .add-tab").attr("title", $.localise.tr("New tab"));

	$("#no-data").html($.localise.tr("No data for selected interval"));

	if (documentationLink) {
		$("#header .help").attr("href", documentationLink);
		$("#header .help").css("display","")
	}

	$("#filter .overlay").html('<span class="icon-search"></span>' + $.localise.tr("Search"));
}

/** Main initialization and handlers binding
 */
var labelGurtamMaps = null;
$(document).ready(function () {
	labelGurtamMaps = APP_CONFIG.alias_webgis || "Gurtam Maps";
	var branch = get_url_parameter("b","master");
	var url = get_url_parameter("baseUrl",(branch=="develop"?"https://dev-api.wialon.com":"https://hst-api.wialon.com"));
	if (!url)
		url = get_url_parameter("hostUrl","http://hosting.wialon.com");
	if (!url)
		return;

	LANG = get_url_parameter("lang","en");
	if (availableLanguages && ($.inArray(LANG, availableLanguages) == -1))
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

	var w = getStorageItem("idrive-width");
	if (w) resizePanel($("#items"), $("#drag"), $("#statistic"), $(window).width(), {pageX:parseInt(w,10)});

	/// generate ticks for plot
	var j=0, ticks = [];
	ticks.push( LOCAL_STATE.criteria[j].yaxis.from );
	for (; j<LOCAL_STATE.criteria.length; j++){
		ticks.push( LOCAL_STATE.criteria[j].yaxis.to );
	}

	/// BINDS
	$("#items")
		.on("click", ".arrow", function(){
			var id = $(this).parent().data("id");
			if (typeof id === 'string' &&  id.indexOf("_") !== -1)
				toggleDriver(id, $(this).parent());
			else
				toggleUnit(id, $(this).parent());
		})
		.on("dblclick", ".item", function(){
			var id = $(this).data("id");
			if (typeof id === 'string' &&  id.indexOf("_") !== -1)
				toggleDriver(id, $(this).parent());
			else
				toggleUnit(id, $(this).parent());
		})
		.on("click", ".check", function(){
			// expand/collapse group
			var $self = $(this);
			var $group = $self.parent().parent();
			var id = $group.data("id");
			if ($self.hasClass("hidden")) {
				// expand
				$group.next().show();
			} else {
				// collapse
				$group.next().hide();
			}
			$self.toggleClass("hidden");
		});

	var mask = $("#filter .mask");
	$("#filter")
		.on("click", ".sort", function() {
			var icons = ["./img/az.svg", "./img/za.svg"];
			var tab_id = LOCAL_STATE.last_sel_tab,
				tab = LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab],
				active =  getUnitsFromTab(tab);

			LOCAL_STATE.sort = (LOCAL_STATE.sort + 1) % 2;

			if (LOCAL_STATE.view) {
				var active = getDriversFromTab(tab);
				if (tab_id == "tab_0" && !active.length) {
					var drivers_list = getStorageItem('drivers_list');
					if (drivers_list)
						active = drivers_list.split(",");
				}
				if (LOCAL_STATE.mode) {
					$("#items .list").html(fillListOfDrivers(LOCAL_STATE.item_cache.avl_drivers_group, active));
				} else {
					$("#items .list").html(fillListOfDrivers(LOCAL_STATE.item_cache.avl_driver, active));
				}

			} else {
				if (LOCAL_STATE.mode) {
					sortListItems(LOCAL_STATE.item_cache.avl_unit_group);
				} else {
					sortListItems(LOCAL_STATE.item_cache.avl_unit);
				}
				// units
				$("#items .list").html(fillListWithItems(false, active));
			}

			$(this).attr("src", icons[LOCAL_STATE.sort])
		})
		.on("click", ".mode", function() {
			var classes = ["icon-list_objects", "icon-list_group_objects"];
			var active = null;
			var tab = LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab];

			// swap classes
			$(this).removeClass(classes[LOCAL_STATE.mode]);
			LOCAL_STATE.mode = (LOCAL_STATE.mode + 1) % 2;
			$(this).addClass(classes[LOCAL_STATE.mode]);

			if (tab.view == 0) {
				active = getUnitsFromTab(tab);
				// resort
				if (LOCAL_STATE.mode) {
					sortListItems(LOCAL_STATE.item_cache.avl_unit_group);
				} else {
					sortListItems(LOCAL_STATE.item_cache.avl_unit);
				}

				$("#items .list").html(fillListWithItems(false, active));
				if (!active.length) {
					$("#add-unit").html($.localise.tr("Add units from the list on the left"));
				}
			} else {
				active = getDriversFromTab(tab);
				if (LOCAL_STATE.mode) {
					$("#items .list").html(fillListOfDrivers(LOCAL_STATE.item_cache.avl_drivers_group, active));
				} else {
					$("#items .list").html(fillListOfDrivers(LOCAL_STATE.item_cache.avl_driver, active));
				}
				if (!active.length) {
					$("#add-unit").html($.localise.tr("Add drivers from the list on the left"));
				}

			}
		})
		.on("click", ".overlay", function() {
			$(this).hide();
			$(mask).focus();
		})
		.on("blur", ".mask", function() {
			var val = $(this).val();
			if (!val) {
				$("#items .overlay").show();
			}
		}).on("input", ".mask", function(evt) {
			/*var active =  getUnitsFromTab(LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab]);
			$("#items .list").html(fillListWithItems(false, active));*/
			var active = null;
			var tab = LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab];
			if (tab.view == 0) {
				active = getUnitsFromTab(tab);
				$("#items .list").html(fillListWithItems(false, active));
			} else {
				active = getDriversFromTab(tab);
				if (LOCAL_STATE.mode) {
					$("#items .list").html(fillListOfDrivers(LOCAL_STATE.item_cache.avl_drivers_group, active));
				} else {
					$("#items .list").html(fillListOfDrivers(LOCAL_STATE.item_cache.avl_driver, active));
				}
			}
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
			setStorageItem("idrive-width", t);
		}
	});

	$("#all-stat").on("click", ".item_tr", function(evt){
		var arr = $(this).attr("id").split("_");
		var id = arr[1];
		if($(evt.target).hasClass("update")){
			$(this).children(".rank, .rate, .mileage, .duration, .trips, .violations").html("<img src='./img/loader.gif'/>");
			$(this).children(".duration").attr("title","").removeClass("update");
			execute(id, true);
		} else {
			var new_tab = "tab_"+LOCAL_STATE.last_sel_tab.split("_")[1]+"_"+id+"_"+LOCAL_STATE.tab_index++;

			var did = null;
			if (LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab].view) {
				did = id + "_" + arr[2];
				new_tab = "tab_" + LOCAL_STATE.last_sel_tab.split("_")[1] + "_" + did + "_" + LOCAL_STATE.tab_index++;
			}

			addTab(new_tab, did);
			LOCAL_STATE.last_sel_tab = new_tab;
		}
	});

    $("#item-info-block")
        .on("click", ".export-to-pdf", exportHandler)
        .on("click", ".export-to-xls", exportHandler);

	$("#all-stat")
		.on("click", ".export-to-pdf", exportHandler)
        .on("click", ".export-to-xls", exportHandler)
		.on("click", ".delete-stat", function() {
			var tab_id = LOCAL_STATE.last_sel_tab;
			var el = $(this).parent(),
				arr = el.attr("id").split("_"),
				id = arr[1],
				type = el.attr("type"),
				tab = LOCAL_STATE.tabs[tab_id];

			if (type === 'driver') {
				id = id + "_" + arr[2];
				for (var i = 0; i < tab.drivers.length; i++) {
					if ( tab.drivers[i].id == id ) {
						abortRequest(tab.drivers[i]);
						tab.drivers[i] = null;
						tab.drivers.splice(i, 1);
                        updateTabContext( tab );
						break;
					}
				}
			} else {
				for (var i = 0; i < tab.units.length; i++) {
					if(tab.units[i].id == id){
						abortRequest(tab.units[i]);
						tab.units[i] = null;
						tab.units.splice(i,1);
                        updateTabContext( tab );
						break;
					}
				}
			}

			if(tab.stat[id]) {
				tab.stat[id] = null;
				delete tab.stat[id];
			}

			el.remove();

			// remove "active" from list
			$(".item_" + id).each(function(i, el) {
				$(el).removeClass("active");
				if (LOCAL_STATE.mode == 1) {
					var groupEl = $(el).closest(".units");
					if (groupEl.size()) {
						var groupId = groupEl.attr("id").split("_")[2];
						if (LOCAL_STATE.view) {
							$(".item_g_" + groupId).removeClass("active");
							activateDriverGroups(id, groupId);
						} else {
							$(".item_" + groupId).removeClass("active");
						}
					}
				}
			});

			if (tab_id == "tab_0") {
				toggleCookie(id, true);
			}

			if (!tab.units.length && !tab.drivers.length)
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
                if ( tab.view ) {
                    sortDrivers(tab);
                } else {
                    sortUnits(tab);
                }
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
			addTab("tab_"+LOCAL_STATE.tab_index++);
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


	$("#clear-all").on("click", function(){
		$('#all-stat .item_tr').each( function () {
			var tab = LOCAL_STATE.last_sel_tab;
			tab = LOCAL_STATE.tabs[tab];
			var id = $(this).attr("id").split("_");
			if (!LOCAL_STATE.view) {
				id = id[1];
			} else {
				id = id[1] + "_" + id[2];
			}

			if (LOCAL_STATE.view) {
				for (var i = 0; i < tab.drivers.length; i++) {
					if (tab.drivers[i].id == id) {
						abortRequest(tab.drivers[i]);
						tab.drivers[i] = null;
						tab.drivers.splice(i, 1);
						break;
					}
				}
			}

			for (var i = 0; i < tab.units.length; i++) {
				if (tab.units[i].id == id) {
					abortRequest(tab.units[i]);
					tab.units[i] = null;
					tab.units.splice(i, 1);
					break;
				}
			}

			if (tab.stat[id]) {
				tab.stat[id] = null;
				delete tab.stat[id];
			}

			$(this).remove();
			// remove "active" from list
			$(".item_" + id).each(function (i, el) {
				$(el).removeClass("active");
				if (LOCAL_STATE.mode == 1) {
					var groupId = $(el).closest(".units").attr("id").split("_");
					if (!LOCAL_STATE.view) {
						groupId = groupId[2];
						$(".item_" + groupId).removeClass("active");
					} else {
						groupId = groupId[2] + "_" + groupId[3];
						$(".item_g_" + groupId).removeClass("active");
					}

				}
			});

			if (!LOCAL_STATE.view) {
				if (!tab.units.length) {

					$("#add-unit").html($.localise.tr("Add units from the list on the left"));
					$("#add-unit").show();
				}
				if (tab == "tab_0") {
					toggleCookie(id, true);
				}
			} else {
				if (!tab.drivers.length) {
					setStorageItem( 'drivers_list', '' );
					$("#add-unit").html($.localise.tr("Add drivers from the list on the left"));
					$("#add-unit").show();

				}
			}


		});
		return false;
	});

	$("#mode_switcher").on("click", unitsDriversSwitcher);


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
				var tab = LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab];
				var uid;
				if (tab.view) {
					uid = tab.did;
				} else {
					uid = LOCAL_STATE.last_sel_tab.split("_")[2];
				}

				showViolations(LOCAL_STATE.last_sel_tab, item.dataIndex, uid);
				PLOT.unhighlight();
				PLOT.highlight(item.series, item.datapoint);
			}
		}
	});
});

function exportHandler( e ) {

    var tab_id = LOCAL_STATE.last_sel_tab;
    var el = $(this).parents('tr.item_tr'),
        arr = el.attr("id"),
        tab = LOCAL_STATE.tabs[tab_id],
        id = null;

    if ( tab.view ) {
        e.stopPropagation();
        return;
    }

    if ( tab.units && tab.units.id ) { // click on head of details table
        id = tab.units.id;
    } else if ( arr ) { // click on table row
        arr = arr.split("_");
        id = arr[1];
    } else { // click on table head
        arr = [];
        tab.units.forEach(function (e) {
            arr.push(e.id);
        });
        id = arr;
    }

    var interval = get_time_from_input(true);
    if ( !interval || interval.length != 2 ) return;
    // find right unit request
    var req = findUnitOnTab(tab, id) || {};
    // additional info
    req.interval = interval;
    req.tab = tab_id;
    req.export = 2;

    if ( e.target.className === 'export-to-xls' ) {
        req.export = 8;
    }
    if ( e.target.parentNode
        && (e.target.parentNode.className === 'export-td'
        || e.target.parentNode.className ===  'export-details-page') ) {
        req.single = 1;
    }

    req.unit_id = id;
    // abort previous request
    abortRequest(req);
    // query Request
    queryRequest(req);
    e.stopPropagation();
}

/** Initialize MAP object
 */
function initMap() {
	var gis_url = wialon.core.Session.getInstance().getBaseGisUrl();
	var user_id = wialon.core.Session.getInstance().getCurrUser().getId();
	var sess = wialon.core.Session.getInstance();
	var gurtam = L.tileLayer.webGis(gis_url,{ attribution: labelGurtamMaps,minZoom: 4, userId: user_id, sessionId: sess.getId()});
	var osm = L.tileLayer('http://{s}.tile.osm.org/{z}/{x}/{y}.png', {
		attribution: '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors',
		minZoom: 4
	});

	var cur = gurtam;
	var layer = getStorageItem("idrive-map");

	if (layer) {
		switch(layer){
			case "WebGis":
			case "Gurtam Maps": cur=gurtam; break;
			case "OpenStreetMap": cur=osm; break;
		}
	} else {
		setStorageItem("idrive-map", labelGurtamMaps);
	}

	MAP = L.map("map", {
		center: [53.505,28.49],
		zoom: 6,
		layers: [ cur ]
	});

	MAP.addEventListener("baselayerchange", function(evt){
		setStorageItem("idrive-map", evt.name);
	});


	var layers = {
		"OpenStreetMap": osm
	};

	layers[labelGurtamMaps] = gurtam;

	L.control.layers(layers).addTo(MAP);
}

/**
 * Update tab content when time interval changed
 */
function updateTabTime() {
	var tab_id = LOCAL_STATE.last_sel_tab;
	var tab = LOCAL_STATE.tabs[tab_id];
	var id = tab_id.split("_")[2];

	if (!tab) {
		return;
	}
	var iname = tab.view ? 'drivers' : 'units';
	if (tab.tab_type) {
		if (tab.view) {
			var driver = LOCAL_STATE.drivers_cache[tab_id.split("_")[2] + "_" + tab_id.split("_")[3]];
			if (!driver) return;
			execute(driver._resid, true);
		} else {
			execute(id, true);
		}

		cleanMap();
		$("#viol-table").html("");
		$("#viol-header").hide();
		$(".rate, .rank", "#item-info-block").html("");
		PLOT.setData([]);
		PLOT.unhighlight();
		PLOT.draw();
	} else { // stat tab update
		var item = null;
		for (var i = 0; i < tab[iname].length; i++) {
			item = tab[iname][i];
			abortRequest(item);
			if (item.timeout) {
				clearTimeout(item.timeout);
			}
			item.timeout = setTimeout(qx.lang.Function.bind(execute, this, item.id, true), 1000);
			$("#row_" + item.id).children(".rank, .rate, .mileage, .duration, .trips, .violations").html("<img src='./img/loader.gif'/>");
			$("#row_" + item.id).children(".duration").attr("title", "").removeClass("update");
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
		LOCAL_STATE.tabs[tab_id].time_changed = 1;
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
	if ( tab ) {
		tab.name = label;
		$( "#"+LOCAL_STATE.last_sel_tab )
			.html( label )
			.attr("title", value<4 ? label.replace(/&ndash;/g, "-").replace(/&nbsp;/g, " ")  : $.localise.tr("Custom"));
	}

	$(".date-time-content").resize();
	return true;
}

/** Toggle unit in list
 *
 *  @param {int} id   unit id
 *  @param {jQuery object} element   unit row in right list
 */
function toggleUnit(id, element) {
	var activate = false;
	var item = findItem(id);
	if (!item) return;

	if (item.getType() == "avl_unit") {
		if (findUnitOnTab(LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab], id) || !item.driveRankSettings)
			return;
		if (LOCAL_STATE.last_sel_tab=="tab_0")
			toggleCookie(id);
		execute(id);
		activate = true;

		$(".item_" + id).addClass("active");
		activateGroups(id);
	} else if (item.getType() == "avl_unit_group") {
		var ids = item.getUnits();
		for (var i = 0; i < ids.length; i++) {
			toggleUnit(ids[i]);
		}
		if (ids.length) {
			activate = true;
		}
	}

	if (activate && element) {
		element.addClass("active");
	}
}
/**
 * Switch units/drivers view function
 * @param e mouse event
 * @returns {boolean}
 */
function unitsDriversSwitcher (e) {
	var data = null;
	var tab_id = LOCAL_STATE.last_sel_tab;
	var tab = LOCAL_STATE.tabs[tab_id];
	if (e)
		data = +e.target.getAttribute('data');
	else
		data = tab.view;

	$('.iw-select .mode_' +(data + 1) % 2).removeClass('active');

	tab.view = data;

	$('.iw-select .mode_' + data).addClass('active');
	var active = null;

	$("#all-stat tbody").html("");
	LOCAL_STATE.view = data;
	if (data === 0) {
		active = getUnitsFromTab(tab);
		LOCAL_STATE.sort = (LOCAL_STATE.sort + 1) % 2;
		if (LOCAL_STATE.mode) {
			sortListItems(LOCAL_STATE.item_cache.avl_unit_group);
		} else {
			sortListItems(LOCAL_STATE.item_cache.avl_unit);
		}

		// units
		$("#items .list").html(fillListWithItems(false, active));
		if (e) {
			if (!active.length) {
				$("#add-unit").html($.localise.tr("Add units from the list on the left"));
				$("#add-unit").show();
			} else {
				$("#add-unit").hide();

				for (var i = 0; i < active.length; i++) {
					addRowToTable(active[i]);
					populateStat(LOCAL_STATE.last_sel_tab, active[i]);
				}
			}
			$("#sort_1").html($.localise.tr("Unit"));
            updateTabContext( tab );
            $('.header .export-to-pdf').show();
            $('.header .export-to-xls').show();
		}
	} else {
		var tab_id = LOCAL_STATE.last_sel_tab;
		var tab = LOCAL_STATE.tabs[tab_id];
		if (!LOCAL_STATE.drivers_cache) {
			searchDrivers(function () {
				var ids = getStorageItem("drivers_list");

				var interval = get_time_from_input(true);

				if (ids) {
					ids = ids ? ids.split(",") : [];


					for (var i = 0; i < ids.length; i++) {
						var driver = LOCAL_STATE.drivers_cache[ids[i]];
						if (!driver) continue;

						var req = {
							id: "" + ids[i],
							xhr: null,
							timeout: null,
							bu: driver.bu
						};
						// additional info
						req.interval = interval;
						req.tab = tab_id;
						tab['drivers'].push(req);
						// abort previous request
						abortRequest(req);
						// query Request
						queryRequest(req);
					}
				}
				printDrivers(tab_id, e);
                updateTabContext( tab );
			});

		} else {
			printDrivers(tab_id, e);
            updateTabContext( tab );
		}
        $('.header .export-to-pdf').hide();
        $('.header .export-to-xls').hide();
	}
	if (tab.time_changed) {
		updateTabTime();
		tab.time_changed = 0;
	}
	return false;
}

function printDrivers (tab_id, e) {
	var tab = LOCAL_STATE.tabs[tab_id];
	var active = getDriversFromTab(tab);
	if (tab_id == "tab_0" && !active.length) {
		var dl = getStorageItem('drivers_list');
		if (dl)
			active = dl.split(",");
	}
	if (LOCAL_STATE.mode) {
		$("#items .list").html(fillListOfDrivers(LOCAL_STATE.item_cache.avl_drivers_group, active));
	} else {
		$("#items .list").html(fillListOfDrivers(LOCAL_STATE.item_cache.avl_driver, active));
	}

	if (e) {
		if (!active.length || active.length === 1 && !active[0]) {
			$("#add-unit").html($.localise.tr("Add drivers from the list on the left"));
			$("#add-unit").show();
		} else {
			$("#add-unit").hide();
			for (var i = 0; i < active.length; i++) {
				addRowToTable(active[i]);
				populateStat(LOCAL_STATE.last_sel_tab, active[i]);
			}
		}
		$("#sort_1").html($.localise.tr("Driver"));
	}
}

/** Toggle driver in list
 *
 *  @param {int} id   unit id
 *  @param {jQuery object} element   unit row in right list
 */
function toggleDriver(id, element) {
	var activate = false;
	if (element && element.hasClass('group')) {
		var ids = id.split("_");
		var g = null;

		var tmp = LOCAL_STATE.item_cache.avl_drivers_group[ids[0]];
		for (var i in tmp) {
			if (tmp[i].id == id) {
				g = tmp[i];
				break;
			}
		}

		if (!g) return;
		var did = null;
		var rid = null;
		for (var i = 0; i < g.drs.length; i++) {
			did = g.drs[i];
			rid = ids[0];
			if (typeof did == "object") {
				did = g.drs[i].id;
				rid = g.drs[i]._resid;
			}

			toggleDriver(rid + "_" + did);
		}
		if (ids.length) {
			activate = true;
		}
	} else {
		var driver = LOCAL_STATE.drivers_cache[id];
		if (!driver) return;

		if (LOCAL_STATE.last_sel_tab == "tab_0")
			toggleCookie(id);

		var tab_id = LOCAL_STATE.last_sel_tab;
		var tab = LOCAL_STATE.tabs[tab_id];
		for (var i = 0; i < tab.drivers.length; i++) {
			if (tab.drivers[i].id === id) {
				return;
			}
		}
		execute(id, 0, driver.bu);
		activate = true;

		$(".item_" + id).addClass("active");
		if ($(".item_" + id).parent('.units').size()) {
			var gid = $(".item_" + id).parent('.units').attr('id').split("_")[2];
			activateDriverGroups(id, gid);
		}
	}

	if (activate && element) {
		element.addClass("active");
	}
}

/**
 *
 * @param id
 * @param gid
 */
function activateDriverGroups(id, gid) {
	// activate all groups with this drivers
	var mask = $("#filter .mask").val(),
		groups = LOCAL_STATE.item_cache.avl_drivers_group,
		active = getDriversFromTab(LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab]),
		i = null,
		e = null,
		drivers = null,
		info = null;

	groups = groups[gid];
	for (e in groups) {

		drivers = getGroupDrivers(groups[e], mask);
		// skip filtred
		if (mask.length && !drivers.length) {
			continue;
		}
		info = getDriverGroupInfo(drivers, active);
		if (drivers.length)
			if (info.active) {
				$(".item_g_" + groups[e].id).addClass("active");
			} else if (!info.active) {
				$(".item_g_" + groups[e].id).removeClass("active");
			}
	}
}

/**
 *
 * @param id
 */
function activateGroups(id) {
	id = parseInt(id);
	// activate all groups with this unit
	var mask = $("#filter .mask").val();
	var groups = LOCAL_STATE.item_cache.avl_unit_group;
	var active =  getUnitsFromTab(LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab]);
	for (var i = 0; i < groups.length; i++) {
		if (groups[i].getUnits().indexOf(id) == -1) {
			continue;
		}

		var units = getGroupUnits(groups[i], mask);
		// skip filtred
		if (mask.length && !units.length) {
			continue;
		}
		var info = getUnitGroupInfo(units, active);
		if (units.length && info.active && info.settings) {
			$(".item_" + groups[i].getId()).addClass("active");
		}
	}
}

/** Get data from server
 *
 *  @param {int} id   unit id
 *  @param {bool} update   if unit already shown on tab and need just update data without adding new row
 */
function execute(id, update, bu) {
	if (!id) return;
	var interval = get_time_from_input(true);
	var tab_id = LOCAL_STATE.last_sel_tab;
	var tab = LOCAL_STATE.tabs[tab_id];

	var name = 'units';
	if (tab.view) name = 'drivers';

	if (!id || !interval || interval.length != 2) return;

	if (!update) {
		if (addRowToTable(id)) {
			tab[name].push({
				id: "" + id,
				xhr: null,
				timeout: null,
				bu: bu
			});
		}
	} else {
		tab.stat[id] = null;
		delete tab.stat[id];
	}
	if (tab.did)
		id = tab.did;
	// find right unit request
	var req = findUnitOnTab(tab, id);
    if ( !req ) {
        return;
    }
	// additional info
	req.interval = interval;
	req.tab = tab_id;

    updateTabContext( tab, id );

	// abort previous request
	abortRequest(req);
	// query Request
	queryRequest(req);
}

function updateTabContext( tab ) {
    var name = tab.view ? 'drivers' : 'units';
    var id = null;
    var item = null;
    var item_name = "";
    if ( tab[name].length === 1 ) {
        id = tab[name][0].id;
    } else if ( tab[name].id ) {
        id = tab[name].id;
    }
    if ( id ) {
        if (tab.view) {
            item = LOCAL_STATE.drivers_cache[id];
            item_name = item.n;
        } else {
            item = findItem(id);
            item_name = item.getName();
        }
    }

    var img = item && typeof item.getIconUrl === 'function' ? item.getIconUrl(16) : false;
    if (item && tab.view) {
        item = LOCAL_STATE.drivers_cache[id];
        img = item.r ? item._res.getDriverImageUrl(item, 16) : "./img/photo-no.png";
    }

    var html = '';
    if ( tab[name].length === 1
        || tab.tab_type === 1 ) {
        html += '<div><img class="icon" alt="" src="' + img + '"/></div>' + '<div>' + item_name + '</div>';
    } else {
        var phrase = tab.view ? 'Drivers: %d' : 'Units: %d';
        if ( tab[name].length === 0 ) {
            phrase = '-';
        } else {
            phrase = wialon.util.String.sprintf( $.localise.tr(phrase), tab[name].length );
        }

        html += '<div>' + phrase + '</div>';
    }
    $( "#tab_context_" + tab.id ).html( html );
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
	var item = null;
	var img = null;
	var name = null;
	var type = null;

	if (typeof id === 'string' &&  id.indexOf("_") !== -1) {
		item = LOCAL_STATE.drivers_cache[id];
		if (!item)
			return false;
		img = item.r ? item._res.getDriverImageUrl(item, 16) : "./img/photo-no.png";
		name = item.n;
		type = "driver";
	} else {
		item = findItem(id);
		if (!item || !item.driveRankSettings)
			return false;
		img = item.getIconUrl(16);
		name = item.getName();
		type = "unit";
	}

	if (!item)
		return false;

	$("#add-unit").hide();

	var tmp = template({
		id: id,
		img: img,
		name: name,
		type: type
	});
	$("#all-stat tbody")
		.append(tmp);

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
    if (req.tab == LOCAL_STATE.last_sel_tab && LOCAL_STATE.tabs[req.tab].tab_type && !req.export) {
		$("#overlay-tab").show();
	}

	// General batch
	var params = [{},
		{ // get driving behavior result
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
	}];

	var u = wialon.core.Session.getInstance().getCurrUser();
	if (!u || !LOCAL_STATE.tabs[req.tab])
		return;

    var tbl = [{
        n: 'unit_ecodriving',
        l: 'Driving behavior',
        f: 0x200110,
        c: 'time_begin,time_end,violation_name,violation_value,max_speed,violation_mark,violations_count,violation_rank',
        cl: 'Beginning,End,Violation name,Value,Max speed,Mark,Violation count,Violation rank',
        sl: '',
        s:'',
        p: '{"grouping":"{\\"type\\":\\"trip_id\\"}","show_all_trips":1,"duration_format":"0","geozones_ex":"{\\"split\\":0}"}',
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
    }, {
        n: 'unit_stats',
        l: 'Statistics',
        f: 0,
        c: '',
        cl: '',
        s: 'us_units',
        sl: '',
        p: '{"us_units":' + MEASURE + '}',
        sch: {y:0,m:0,w:0,f1:0,f2:0,t1:0,t2:0}
    }];
    var rep_ct = 'avl_unit';
    var column_names = '';
    // clicked on one unit
    if ( req.export && req.single ) {
        column_names = [
            $.localise.tr('Beginning'),
            $.localise.tr('End'),
            $.localise.tr('Penalty'),
            $.localise.tr('Violation name'),
            $.localise.tr('Value')
        ];
        tbl = [{
            n: 'unit_stats',
            l: 'Statistics',
            f: 0,
            c: '',
            cl: '',
            s: 'us_units',
            sl: '',
            p: '{"us_units":' + MEASURE + '}',
            sch: {y:0,m:0,w:0,f1:0,f2:0,t1:0,t2:0}
        }, {
            n: 'unit_ecodriving',
            l: 'Driving behavior',
            f: 256,
            c: 'time_begin,time_end,violation_mark,violation_name,violation_value',
            cl: column_names.toString(),
            sl: '',
            s:'',
            p: '{"grouping":"{\\"type\\":\\"trip_id\\"}","show_all_trips":1,"duration_format":"0","geozones_ex":"{\\"split\\":0}"}',
            sch: {y:0,m:0,w:0,f1:0,f2:0,t1:0,t2:0}
        }];
        params = [{}];
        delete req.single;
    } else if ( req.export ) {
        column_names = [
            $.localise.tr('Rank'),
            $.localise.tr('Penalty'),
            $.localise.tr('Count'),
            $.localise.tr('Duration'),
            $.localise.tr('Mileage')
        ];
        tbl = [{
            n: 'unit_group_ecodriving',
            l: 'Driving behavior',
            f: 0,
            c: 'violation_rank,violation_mark,violations_count,duration,mileage',
            cl: column_names.toString(),
            sl: '',
            s: '',
            p: '{"grouping":"{\"type\":\"unit\"}"}',
            sch: {y: 0, m: 0, w: 0, f1: 0, f2: 0, t1: 0, t2: 0}
        }];
        rep_ct = 'avl_unit_group';
        params = [{}];
    }

	var rid = 0;
    if ( typeof req.id === 'string' ) {
        rid = req.id.split('_')[0];
    }
	params[0] = { // exec report
			svc: 'report/exec_report',
			params:{
				reportResourceId: LOCAL_STATE.tabs[req.tab].view ? rid : u.getAccountId(),
				reportTemplateId: 0,
				reportObjectId: rid,
				reportObjectSecId:0,
				interval: {
					flags: 0,
					from: req.interval[0],
					to: req.interval[1]
				},
				reportTemplate:{
					n: 'EcoDriving report',
					ct: rep_ct,
					p:'',
					tbl: tbl
				}
			}
		};

	if ( req.id && req.id.split("_").length > 1 ) {// Drivers

		params[0].params.reportObjectId = parseInt(req.id.split("_")[0]);
		params[0].params.reportObjectSecId = req.id.split("_")[1];
		params[0].params.reportTemplate.ct = 'avl_driver';

		params[0].params.reportTemplate.tbl = [{
			n: 'driver_bindings',
			l: 'Bindings',
			f: 0,
			c: "",
			cl: "",
			p: "",
			sch: {y: 0, m: 0, w: 0, f1: 0, f2: 0, t1: 0, t2: 0},
			sl: 'Trip routes',
			s: 'render_msgs,render_trips'
		}, {
			n: 'unit_ecodriving',
			l: 'Driving behavior',
			f: 0x200110,
			c: 'time_begin,time_end,violation_name,violation_value,max_speed,violation_mark,violations_count,violation_rank,duration,mileage',
			cl: 'Beginning,End,Violation name,Value,Max speed,Mark,Violation count,Violation rank,Duration,Mileage',
			sl: '',
			s: '',
			p: '{"grouping":"{\\"type\\":\\"trip_id\\"}","show_all_trips":1,"duration_format":"0","geozones_ex":"{\\"split\\":0}"}',
			sch: {y: 0, m: 0, w: 0, f1: 0, f2: 0, t1: 0, t2: 0}
		}, {
			n: 'driver_stats',
			l: 'Statistics',
			f: 0,
			c: '',
			cl: '',
			s: 'us_units',
			sl: '',
			p: '{"us_units":' + MEASURE + '}',
			sch: {y: 0, m: 0, w: 0, f1: 0, f2: 0, t1: 0, t2: 0}
		}];
	}
	// it is not export button pressed
    if ( !req.export ) {
        wialon.core.Remote.getInstance().remoteCall('report/cleanup_result', {}, function () {
        });
    } else if ( typeof req.unit_id === 'object' && req.unit_id.length ) {
        params[0].params.reportObjectId = req.unit_id.splice( 0, 1 )[0];
        params[0].params.reportObjectSecId = 0;
        params[0].params.reportObjectIdList = req.unit_id;
    }

	wialon.core.Remote.getInstance().remoteCall('core/batch', params, function (code, obj) {
		// if a still alive
		var finalData = {
			mileage: 0,
			duration: 0,
			trips: []
		};

		ACTIVE = null;
		queryRequest();

        var result = null;
        if (code === 0 && obj && obj.length && req.export && !('error' in obj[0]) && ('reportResult' in obj[0])) {
            result = obj[0].reportResult;

                var item = findItem( req.unit_id ) || "";

                if ( item ) {
                    item = "_" + item.getName();
                }
                var params = {
                    attachMap: 1,
                    extendBounds: 0,
                    compress: 0,
                    delimiter: "semicolon",
                    outputFileName: 'export' + item,
                    pageOrientation: "landscap",
                    pageSize: "a4",
                    pageWidth: "0"
                };
                if (!$("#download_report_file").size())
                    $("body").append("<iframe id='download_report_file' style='display: none'></iframe>");

                $("#download_report_file").attr("src", getExportUrl(req.export, params));

                delete req.export;
                return;
            }


		if (code === 0 && obj && obj.length && obj.length == 3
            && !('error' in obj[0])
            && ('reportResult' in obj[0])
            ) {

			var len = 0;
            result = obj[0].reportResult;
			var is_driver = result.tables.length == 1 && result.tables[0].name === "unit_ecodriving";
			var t0 = result.tables[0] || {},
				ht = t0.header_type || [];


			// both unit_driverank and unit_trips exists
			var rate_id = (function(arr) {
				return arr.indexOf('violation_mark')
			})(ht);

			var rank_id = (function(arr) {
				return arr.indexOf('violation_rank')
			})(ht);

			var viol_count_id = (function(arr) {
				return arr.indexOf('violations_count')
			})(ht); //violations_count array ID

			var viol_name_id = (function(arr) {
				return arr.indexOf('violation_name')
			})(ht); //violation_name array ID


			// get data from Total
			if (result.tables.length == 2 || is_driver) {
				len = t0.total.length;
				// result.tables[0] - unit_driverank
				finalData.rate = result.tables[0].total[rate_id];
				finalData.rank = result.tables[0].total[rank_id];

				// result.tables[1] - unit_trips
				var trips_result = result.tables[1];
				if (is_driver) {
					trips_result = t0;
					finalData.mileage = trips_result.totalRaw[10].v;
					finalData.duration = trips_result.totalRaw[9].v;
				} else {
					finalData.mileage = trips_result.totalRaw[3].v;
					finalData.duration = trips_result.totalRaw[2].v;
				}
			}

			var trips = obj[2];
			var violations = obj[1];
			// sometimes errors' comming
			if (trips.error) {
				trips = [];
				if (is_driver)
					trips = violations;
			}

			if (violations.error) {
				violations = [];
			}
			var v = null;
            if ( trips.length ) {
                finalData.violations_count = 0;
            }
			// construct result array
			for (var i = 0, vi = 0; i < trips.length; i++) {
				// init violations stats
				trips[i].viol = {};
				trips[i].rate = 0;
				trips[i].rank = null;
				// check if violations were in cur trip

				if (vi < violations.length
                    && trips[i].t1 <= violations[vi].t1
                    && trips[i].t2 >= violations[vi].t1
				/*
				    fix all report algorithms on wdc work only at the 'time from'
				  && violations[vi].t2 <= trips[i].t2
				  */) {
					len = violations[vi].c.length;
					trips[i].rate = parseInt(violations[vi].c[rate_id].t, 10);
					// info about rank exists in report
					if (len > 8) {
						trips[i].rank = violations[vi].c[rank_id].t;
					}

					if (violations[vi].r) {
						/*finalData.violations_count += violations[vi].r.length;*/
						// trips violation loop
						for (var j = 0, viol = null; j < violations[vi].r.length; j++) {
							v = violations[vi].r[j];
							// violation
							viol = v.c;

							if (viol[viol_count_id - 1].v === 0) {
								continue;
							}

							finalData.violations_count++;

							if (len >= 8) {
								// remove first 'group' column
								viol = viol.slice(1);
								// skip zero violations
								if (viol[rate_id - 1].v == 0) {
									continue;
								}
							}

							// group violations by type
							if (!(viol[viol_name_id - 1].v in trips[i].viol)) {
								trips[i].viol[viol[viol_name_id - 1].v] = [viol];
							} else {
								trips[i].viol[viol[viol_name_id - 1].v].push(viol);
							}
						}
					}
					vi++;
				}
			}
			// add tirps to final data
			finalData.trips = trips;
			// show result data
			handleData(req, finalData);
		}
	});
}

function getExportUrl (format, parameters) {
    var params = qx.lang.Object.clone(parameters);
    params.format = format;
    return wialon.core.Session.getInstance().getBaseUrl()
        + "/wialon/ajax.html?sid=" + wialon.core.Session.getInstance().getId() +
        "&svc=report/export_result&params=" + encodeURIComponent(wialon.util.Json.stringify(params));
}

function get_binding_units (tab, ind) {
	var arr = tab.did.split('_'),
		rid = arr[0],
		driver_id = arr[1];

	var stat_id = tab.did;
	var plot_index = tab.stat[stat_id].plot_trips[ind];
	var trip = tab.stat[stat_id].trips[plot_index];

	var params = {
			resourceId: rid,
			unitId: 0,
			driverId: driver_id,
			timeFrom: trip.t1,
			timeTo: trip.t2
	};

	wialon.core.Remote.getInstance().remoteCall('resource/get_driver_bindings', params, qx.lang.Function.bind(function (tab, ind, code, obj) {
		if (code)
			return;

		tab.bindings = obj[tab.did.split('_')[1]];

		load_driver_track(tab, ind);
	}, LOCAL_STATE, tab, ind));
}

function load_driver_track (tab, ind) {
	// General batch
	var params = [];

	var sess = wialon.core.Session.getInstance();
	var ml = sess.getMessagesLoader();


	var iname = tab.view ? 'drivers' : 'units';
	var stat_id = tab.did;

	var plot_index = tab.stat[stat_id].plot_trips[ind];
	var trip = tab.stat[stat_id].trips[plot_index];

	for (var i = 0; i < tab.bindings.length; i++) {

		params.push( {
			svc: 'messages/load_interval',
			params: {
				itemId:  tab.bindings[i].u,
				timeFrom: trip.t1,
				timeTo: trip.t2,
				flags:0,
				flagsMask: 0xFF00,
				loadCount: 0xFFFFF
			}
		});
	}

	wialon.core.Remote.getInstance().remoteCall('core/batch', params, function (code, data) {

		if (!code) {

			var messages = [];
			for (var i = 0; i < data.length; i++) {
				messages = messages.concat(data[i].messages);
			}

			draw_polyline({
				messages: messages
			});
		}
	});
}

/** Handle report data ( @see execute )
 *
 *  @param {String} tab   tab id
 *  @param {int} id   unit id
 *  @param {object} data   json data about unit
 */
function handleData(req, data) {
	if (!req || !req.xhr){
		return;
	}
	var id = req.id;
	var tab = req.tab;
	if (req.hash && req.xhr && data.hash!=req.xhr.hash || !LOCAL_STATE.tabs[tab]){
		return;
	}

	req.xhr = null;
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
function populateStat(tab, id, limit, leave) {
	var tab_info = tab.split("_");

	if ( tab === 'tab_0' || tab_info.length == 2 && tab_info[0] === 'tab' ) {
		var tag = $("#row_"+id),
			stat = LOCAL_STATE.tabs[tab].stat[id];
		var mileage = 0;
		if (LOCAL_STATE.tabs[tab].stat[id]) {
			if(stat.error){
				tag.children(".rank, .rate, .mileage, .duration, .trips, .violations").html("");
				tag.children(".duration").attr("title", $.localise.tr("Error while getting data")).addClass("update");
			} else {
				mileage = stat.mileage ? (stat.mileage / 1000).toFixed(1) : "-";
				tag.children(".duration").html( stat.duration ? toHHMMSS(stat.duration) : "-" );
				tag.children(".mileage").html(mileage);
				tag.children(".rate").html(stat.rate != null ? stat.rate : "-");
				tag.children(".rank").html(stat.rank != null ? stat.rank : "-");
				tag.children(".trips").html(stat.trips.length || "-");
				tag.children(".violations").html(stat.trips.length ? stat.violations_count : "-");
			}
		} else {
			tag.children(".rank, .rate, .mileage, .duration, .trips, .violations").html("<img src='./img/loader.gif'/>");
			tag.children(".duration").attr("title","").removeClass("update");
		}
	} else {
		showStatistic(tab, limit, leave);
	}
}

/** Show calculated statistic on unit tab
 *
 *  @param {String} tab   tab id
 *  @param {int} limit   min trip length
 *  @param {bool} leave   leave same trip selected (otherwise, select trip with min rate)
 */
function showStatistic(tab_id, limit, leave){
	var tab_info = tab_id.split("_");
	if (tab_info[0] != "tab" || (tab_info.length != 4 && tab_info.length != 5))
		return;

	var tab = LOCAL_STATE.tabs[tab_id];
	var id = tab_info[2];
	var item = null;

	if (tab.view) {
		item = LOCAL_STATE.resources[id];
		id = tab_info[2] + '_' + tab_info[3];
	} else {
		item = findItem(id);
	}

	if(!tab.stat[id] || !tab.stat[id].trips || !item)
		return;

	var item_name = item.getName();
	if (tab.view) {
		item_name = item.getDriver(tab.did.split('_')[1]).n;
	}
	cleanMap();
	toggleHover();
	$("#viol-table").html("");
	$("#viol-header").hide();

	$("#item-info-block .rank")
		.html(tab.stat[id].rank ? tab.stat[id].rank + "" : "&nbsp;")
		.attr("title", tab.stat[id].rank != null ? tab.stat[id].rank : "");
	$("#item-info-block .rate")
		.html(tab.stat[id].rate ? tab.stat[id].rate + "" : "&nbsp;")
		.attr("title", tab.stat[id].rate != null ? tab.stat[id].rate : "");

	$("#item-info-block .unit").html(item_name);

	var trips = tab.stat[id].trips;
	var K = [], max = trips.length, plot_trips = [], maxRate = 0;
	var select_index = 0, select_value = 0, limited_count = 0, total = 0, t = 0;
	for (var i = 0, r = 0; i < max; i++){
		if ((limit > 0 && trips[i].m < limit*1000) || (trips[i].m === 0)) {
			limited_count++;
			continue;
		}

		t = trips[i].t2 - trips[i].t1;
		r = trips[i].rate;
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

	// recalculate min height for trips without violations
	for (var i = 0; i < K.length; i++){
		if (K[i][1] == 0) {
			K[i][1] = (maxRate || 10) * 0.025;
		}
	}

	$("#no-data").css("display", max==limited_count || max===0 ? "block" : "none");

	tab.stat[id].plot_trips = plot_trips;

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


		showViolations(tab_id, select_index, id);
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
	$("#items .item.active").removeClass("active");

	if (!after_sort) {
		$("#all-stat .sort:visible").css("display","none");
		if (tab.sort) {
			$("#sort_"+Math.abs(tab.sort)).next("img")
				.attr("src","img/"+(tab.sort>0?"az.png":"za.png"))
				.css("display","inline-block");
		}
	}

	var name = 'units';
	if (tab.view) {
		name = 'drivers';
		$("#add-unit").html($.localise.tr("Add drivers from the list on the left"));
	} else {
		$("#add-unit").html($.localise.tr("Add units from the list on the left"));
	}
    if (!after_sort) unitsDriversSwitcher();
	if (tab[name].length) {
		$("#add-unit").hide();

		for (var i = 0; i < tab[name].length; i++) {
			$(".item_"+tab[name][i].id).addClass("active");
			addRowToTable(tab[name][i].id);
			populateStat(id_tab, tab[name][i].id);

			if (LOCAL_STATE.mode == 1) {
				activateGroups(tab[name][i].id);
			}
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

		if (tab) {
			var stat_id = tab.units.id;
			if (tab.did) {
				stat_id = tab.did;
			}

			if (tab.stat[stat_id]) {
				var plot_index = tab.stat[stat_id].plot_trips[item.dataIndex];
				var stat = tab.stat[stat_id].trips[plot_index];
				var obj = $("#plot-hover");

				var from_to = formatDateRange(
					wialon.util.DateTime.formatTime(stat.t1, false, DATE_FORMAT),
					wialon.util.DateTime.formatTime(stat.t2, false, DATE_FORMAT)
				);

				var trip = " ";
				var mileage_column_num = 3;
				if (tab.view) {
					mileage_column_num = stat.c.length - 1;
				}
				var mile = stat.c[mileage_column_num].v;

				if (MEASURE == 1 || MEASURE == 2) {
					trip += (mile / 1000).toFixed(1) + " " + $.localise.tr("mi");
				} else {
					trip += (mile / 1000).toFixed(1) + " " + $.localise.tr("km");
				}
				obj.find(".time").html(from_to);
				obj.find(".rate").html("<b>" + stat.rate + "</b>");
				obj.find(".rank").html("<b>" + (stat.rank || 6) + "</b>");
				obj.find(".mileage").html($.localise.tr("Trip length") + trip + ", " + toHHMMSS(stat.t2 - stat.t1));

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
				(PLOT.p2c({x1: item.datapoint[0] + item.datapoint[2] / 2}).left | 0) - 95 + PLOT.getPlotOffset().left :
				item.pageX - 95;
				if (x < 5)
					x = 5;
				else if ($(window).width() - x < 195)
					x = $(window).width() - 195;
				obj.stop(0, 1).fadeIn(100).offset({left: x});
			}
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

function draw_polyline ( data ) {

	var i = 0;
	for (i = 0; i < MULTIPOLY.length; i++) {
		if (MULTIPOLY[i]) {
			MAP.removeLayer(MULTIPOLY[i]);
		}
	}

	var multipoly = [[], [], [], [], []], poly = [];
	var index = 0, cur = [], cur_index = null;
	i = 0;
	while (i < data.messages.length) {
		if (data.messages[i] && data.messages[i].pos && data.messages[i].pos.x && data.messages[i].pos.y) {
			index = getSpeedIndex(data.messages[i].pos.s);
			if (index != cur_index) {
				if (cur_index >= 0 && cur.length) {
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
	if (cur_index >= 0 && cur.length) {
		multipoly[cur_index].push(cur);
	}

	var bounds = new L.LatLngBounds();
	for (i = 0; i < multipoly.length; i++) {
		if (multipoly[i].length) {
			MULTIPOLY[i] = new L.MultiPolyline(multipoly[i], {
				color: LOCAL_STATE.speed_color[i], opacity: 0.8, clickable: false, weight: 6
			}).addTo(MAP);
			bounds.extend(MULTIPOLY[i].getBounds());
		}
	}
	if (!LOCAL_STATE.map_bounds.length) {
		LOCAL_STATE.map_bounds = [
			[bounds.getNorth(), bounds.getEast()],
			[bounds.getSouth(), bounds.getWest()]
		];
		MAP.fitBounds(bounds, {padding: [10, 10]});
	}
}

/** Populate violation for selected trip
 *
 *  @param {String} id   tab id
 *  @param {int} ind   index of trip (0 <= ind < trips.length)
 */
function showViolations(id, ind, uid) {
	cleanMap();

	var tab = LOCAL_STATE.tabs[id];
	var iname = tab.view ? 'drivers' : 'units';
	var stat_id = tab.view ? tab.did : tab[iname].id;

	var plot_index = tab.stat[stat_id].plot_trips[ind];
	var trip = tab.stat[stat_id].trips[plot_index];
	var sess = wialon.core.Session.getInstance();
	var ml = sess.getMessagesLoader();
	if (MAP) {
		var _id = tab[iname].id;
		if (tab.view) { //
			_id = tab.did.split('_')[0];
		}
		if (tab.view) {
			get_binding_units(tab, ind);
		} else {
			ml.loadInterval(parseInt(_id), trip.t1, trip.t2, 0, 0xFF00, 0xFFFFF,
				qx.lang.Function.bind(function (tab, plot_index, code, data) {
					if ( LOCAL_STATE.last_sel_tab == tab && LOCAL_STATE.last_flot_click == ind && !code) {
						draw_polyline(data);
					}
				}, null, id, ind)
			);
		}
	}
	var bounds = [];
	var template = _.template($("#viol-row").html());
	var html = [];

	var viol = getAllViolations(id, trip, uid);
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
				t = "<b>" + t[0] + "</b> " + t[1];
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
	if (tab.did)

	trip = tab.stat[uid].trips[plot_index];
	var from_to = formatDateRange(
		wialon.util.DateTime.formatTime(trip.t1, false, DATE_FORMAT),
		wialon.util.DateTime.formatTime(trip.t2, false, DATE_FORMAT)
	);
	$("#viol-header").show().children("span").html(
		"<span class='label'>"+$.localise.tr("Violations of the trip")+"</span> " + from_to
	);
}

/** Get color index to colorize track by speed
 *
 *  @param {String} speed   speed in kilometers
 */
function getSpeedIndex(speed){
	speed = (!speed || speed < 0) ? 0 : speed;
	if (MEASURE == 1 || MEASURE == 2) {
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
function getAllViolations(id, trip, uid){
	var tab_info = id.split("_");
	if(tab_info.length != 4 && tab_info.length != 5)
		return [];

	var viol = trip.viol;
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

/** Get units of group

 * @param group {object}   wialon avl_unit_group
 * @returns {array} list of wialon avl_units
 */
function getGroupUnits(group, mask) {
	var units = [];
	var ids = group.getUnits();
	for (var i = 0, unit; i < ids.length; i++) {
		unit = findItem(ids[i]);
		if (unit && checkName(unit, mask)) {
			units.push(unit);
		}
	}

	return units;
}

/** Get drivers of group
 * @param group {object}   wialon avl_driver_group
 * @returns {array} list of wialon avl_drivers
 */
function getGroupDrivers (group, mask) {
	var ds = [];
	var ids = group.drs;
	var rid = +group._resid;

	if (!mask)
		mask = "";

	for (var i = 0, d; i < ids.length; i++) {
		rid = rid || ids[i]._resid || ids[i]._res.getId();
		if (typeof ids[i] == "object") {
			d = LOCAL_STATE.drivers_cache[rid + "_" + ids[i].id];
		} else
			d = LOCAL_STATE.drivers_cache[rid + "_" + ids[i]];

		if (d && checkName(d, mask)) {
			ds.push(d);
		}
	}

	return ds;
}

/** Check if unit group active and has settings
 */
function getUnitGroupInfo(units, active) {
	var isActive = (units.length > 0);
	var withSettings = false;
	for (var j = 0; j < units.length; j++) {
		// check settings exists
		if (!withSettings && units[j].driveRankSettings) {
			withSettings = true;
		}
		// check if already active
		if (isActive && units[j].driveRankSettings && active.indexOf("" + units[j].getId()) == -1) {
			isActive = false;
		}
	}
	return {
		active: isActive,
		settings: withSettings
	};
}



/** Check if drivers group active and has settings
 */
function getDriverGroupInfo(drivers, active) {
	var acts = 0,
		id = null;

	for (var j = drivers.length; j-- ;) {
		if (typeof drivers[j] == "object")
			id = (drivers[j]._resid || drivers[j]._res.getId()) + "_" + drivers[j].id;

		// check if already active
		if (active.indexOf(id) !== -1) acts++;
	}
	return {
		active: acts === drivers.length
	};
}

/** Find unit/unit_group in cache
 *
 *  @param {int} id   item id
 *  @returns {avl_unit || avl_unit_group || null} wialon unit object
 */
function findItem(id){
	var types = ['avl_unit', 'avl_unit_group'];
	for (var i = 0, t; i < types.length; i++) {
		t = types[i];
		if(LOCAL_STATE.item_cache[t]){
			var len = LOCAL_STATE.item_cache[t].length;
			for (var j = 0; j < len; j++) {
				if(LOCAL_STATE.item_cache[t][j].getId() == id) {
					return LOCAL_STATE.item_cache[t][j];
				}
			}
		}
	}
	return null;
}

function findDriver(id){
    if (LOCAL_STATE.drivers_cache[id]) {
        return LOCAL_STATE.drivers_cache[id];
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
		var name = 'units';
		if (tab.view) {
			name = 'drivers';
		}
		if(tab.tab_type)
			return tab[name].id==id ? tab[name] : null;
		else
			for (var i=0; i<tab[name].length && tab; i++)
				if(tab[name][i].id==id)
					return tab[name][i];
	}
	return null;
}

/** Check unit name against mask
 */
function checkName(item, mask) {
	if (!mask) {
		return true;
	}
	mask = "" + mask.toUpperCase();
	var name = "";
	if (typeof item.getName === "function")
		name = item.getName().toUpperCase();
	else
		name = item.n.toUpperCase();
	return name.indexOf(mask) > -1;
}

/** Get units ids
 *
 *  @param {object} tab   internal tab object (@see LOCAL_STATE.tabs)
 * @returns {array} ids
 */
function getUnitsFromTab(tab) {
	var ids = [];
	for (var i = 0; i < tab.units.length && tab; i++) {
		ids.push(tab.units[i].id);
	}
	return ids;
}

function getDriversFromTab(tab) {
	var ids = [];
	for (var i = 0; i < tab.drivers.length && tab; i++) {
		ids.push(tab.drivers[i].id);
	}
	return ids;
}

/** Get unique color for new tab
 *
 *  @returns {int} index of color (@see LOCAL_STATE.colors)
 */
function getColor(){
	var letters = '0123456789ABCDEF';
	var color = '#';
	for (var i = 0; i < 6; i++) {
		color += letters[Math.floor(Math.random() * 16)];
	}
	return color;
}

/** Save/remove unit id to cookie
 *
 *  @param {int} id   unit id
 *  @param {bool} remove   true - remove from cookie
 */
function toggleCookie(id, remove){
	id = "" + id;
	var iname = LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab].view ? 'drivers_list' : 'idrive';
	var ids = getStorageItem(iname);
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
		setStorageItem( iname, ids.join(",") );
}

///localStorage
function setStorageItem(name, value) {
	/// set value to storage
	var storage = window.localStorage;
	if (storage && name)
		storage.setItem(name, escape(value));
}
function getStorageItem(name) {
	/// return value from storage
	var storage = window.localStorage;
	if (storage && name)
		if (name in storage)
			return unescape( storage.getItem(name));
	return;
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
				function(x){ var u = findItem(x); return u ? u.getName().toUpperCase() : ""; },
				"id", tab.sort>0)
			);
		break;
		case 2: //sort by rate
			tab.units.sort(sortBy(
				function(x){
					return tab.stat[x] && tab.stat[x].rate!==null ? +(tab.stat[x].rate) : -1; },
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
				function(x){ return tab.stat[x] && typeof tab.stat[x].violations_count !== 'undefined' ? +(tab.stat[x].violations_count) : -1; },
				"id", tab.sort>0)
			);
		break;
		case 7: // sort by violations rank
			tab.units.sort(sortBy(
				function(x){
					return tab.stat[x] && typeof tab.stat[x].rank !== 'undefined' ? +(tab.stat[x].rank) : -1; },
				"id", tab.sort>0)
			);
		break;
	}
}

function sortDrivers(tab) {
    var sort = Math.abs(tab.sort);
    switch (sort) {
        case 1: // sort by unit name
            tab.drivers.sort(sortBy(
                    function(x){
                        var d = findDriver(x);
                        return d ? d.n.toUpperCase() : "";
                    },
                    "id", tab.sort>0)
            );
            break;
        case 2: //sort by rate
            tab.drivers.sort(sortBy(
                    function(x){
                        return tab.stat[x] && tab.stat[x].rate!==null ? +(tab.stat[x].rate) : -1; },
                    "id", tab.sort>0)
            );
            break;
        case 3: //sort by mileage
            tab.drivers.sort(sortBy(
                    function(x){ return tab.stat[x] && tab.stat[x].mileage ? tab.stat[x].mileage : -1; },
                    "id", tab.sort>0)
            );
            break;
        case 4: //sort by trips count
            tab.drivers.sort(sortBy(
                    function(x){ return tab.stat[x] && tab.stat[x].trips.length ? tab.stat[x].trips.length : -1; },
                    "id", tab.sort>0)
            );
            break;
        case 5: // sort by duration
            tab.drivers.sort(sortBy(
                    function(x){ return tab.stat[x] && tab.stat[x].duration ? tab.stat[x].duration : -1; },
                    "id", tab.sort>0)
            );
            break;
        case 6: // sort by violations count
            tab.drivers.sort(sortBy(
                    function(x){
                        return tab.stat[x] && typeof tab.stat[x].violations_count !== 'undefined' ? +(tab.stat[x].violations_count) : -1;
                    },
                    "id", tab.sort>0)
            );
            break;
        case 7: // sort by violations rank
            tab.drivers.sort(sortBy(
                    function(x){
                        return tab.stat[x] && typeof tab.stat[x].rank !== 'undefined' ? +(tab.stat[x].rank) : -1; },
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
function addTab(tab_id, did) {
	var tab_info = tab_id.split("_");
	if ( tab_info[0]!="tab"
		|| (tab_info.length!=2 && tab_info.length!=4 && tab_info.length!=5) )
		return;

	var parent_tab = "";
	if (tab_info.length >= 4)
		parent_tab = "tab_"+tab_info[1];

	var tab = LOCAL_STATE.tabs[tab_id];
	var old_tab = LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab];
	if (!tab){
		var obj = {stat:{}};
		obj.tab_type = tab_info.length >= 4 ? 1 : 0; // 0 - Statistic, 1 - Unit
		var item = null;
		if (obj.tab_type) {

			obj.view = old_tab.view;
			obj.units = {};
			obj.drivers = {};

			var uid = tab_info[2];
			var tab_unit = null;
			var drv = null;

			if (obj.view) {
				tab_unit = findUnitOnTab(LOCAL_STATE.tabs[parent_tab], did);
				obj.stat[did] = clone(LOCAL_STATE.tabs[parent_tab].stat[did]);
				obj.drivers.id = did;
				obj.drivers.xhr = tab_unit ? tab_unit.xhr : null;
			} else {
				tab_unit = findUnitOnTab(LOCAL_STATE.tabs[parent_tab], uid);
				obj.units.id = uid;
				obj.units.xhr = tab_unit ? tab_unit.xhr : null;
				obj.stat[uid] = clone(LOCAL_STATE.tabs[parent_tab].stat[uid]);
			}

			if (did) {
				item = LOCAL_STATE.resources[uid];
				drv = item.getDriver(did.split('_')[1]);
			} else {
				item = findItem(uid);
			}

			if (!item)
				return;

			obj.name = drv ? drv.n : item.getName();
			obj.time_type = LOCAL_STATE.tabs[parent_tab].time_type;
			obj.time_from = LOCAL_STATE.tabs[parent_tab].time_from;
			obj.time_to = LOCAL_STATE.tabs[parent_tab].time_to;
			obj.color = LOCAL_STATE.tabs[parent_tab].color;
			obj.parent = parent_tab;
            obj.time_type = $("#dateinterval").intervalWialon("type");
            var interval = get_time_from_input();
            obj.time_from = interval[0];
            obj.time_to = interval[1];

			obj.did = did;
            obj.id = tab_id;
		} else {
			// statistic tab
			obj.units = [];
			obj.drivers = [];
			obj.name = "";
			obj.time_type = $("#dateinterval").intervalWialon("type");
			var interval = get_time_from_input();
			obj.time_from = interval[0];
			obj.time_to = interval[1];
			obj.color = getColor();
			obj.sort = 0;
			obj.view = old_tab ? old_tab.view : 0;
            obj.id = tab_id;
		}
		LOCAL_STATE.tabs[tab_id] = obj;

		var template = _.template($("#item-tab-template").html());
        var c_html = "";
        c_html = "<div class='tab-context tab' id='tab_context_" + tab_id + "' >-</div>";

		var tmp = template({
			"id": tab_id,
			"context": c_html,
			"cls": parent_tab ? parent_tab : tab_id + " limited-tab",
			"name": LOCAL_STATE.tabs[tab_id].name,
			"title": LOCAL_STATE.tabs[tab_id].name,
			"close": tab_id === "tab_0" ? false : true,
			"color": obj.color,
			"tab_type": obj.tab_type,
			"img": item && typeof item.getIconUrl === 'function' ? item.getIconUrl(16) : false
		});

		if ($("#tabs ."+(parent_tab ? parent_tab : tab_id)).size()){
			$("#tabs ."+(parent_tab ? parent_tab : tab_id)).last().parent().after(tmp);
		} else {
			$("#tabs .add-tab").before(tmp);
		}

		$("#footer .scroll").resize();
	}
	switchTab(tab_id);
}

/** Switch to tab and change whole page content
 *
 *  @param {Sring} tab_id   tab id
 */
function switchTab(tab_id) {
    if ( tab_id.split('tab_context_').length > 1 ) {
        tab_id = tab_id.split('tab_context_')[1];
    }
	var old_tab = LOCAL_STATE.tabs[LOCAL_STATE.last_sel_tab];
	var tab = LOCAL_STATE.tabs[tab_id];
	if (LOCAL_STATE.last_sel_tab == tab_id || !tab)
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
			"border-color": LOCAL_STATE.colors[old_tab.color]
		});

	var $itemInfoBlock = $("#item-info-block");
	if(tab.tab_type){
		tab_html.parent().css({"border-color":LOCAL_STATE.colors[tab.color]});
		var rate = tab.stat[tab.units.id] && tab.stat[tab.units.id].rate ? tab.stat[tab.units.id].rate : "";
		var rank = tab.stat[tab.units.id] && tab.stat[tab.units.id].rank ? tab.stat[tab.units.id].rank : "";
		$itemInfoBlock.show().children(".rate").html(rate);
		$itemInfoBlock.children(".rank").html(rank);
	} else {
		$itemInfoBlock.hide();
	}

    if ( tab.view ) {
        $('.header .export-to-pdf').hide();
        $('.header .export-to-xls').hide();

        $('.export-details-page').hide();

    } else {
        $('.header .export-to-pdf').show();
        $('.header .export-to-xls').show();

        $('.export-details-page').show();
    }

	LOCAL_STATE.tab_history.push(tab_id);

	LOCAL_STATE.last_sel_tab = tab_id;
	LOCAL_STATE.last_flot_click = null;
	PLOT.unhighlight();
	$("#dateinterval").intervalWialon("set", tab.time_type, [tab.time_from, tab.time_to], true);
    updateTabContext( tab );
	activateTimeTemplate(parseInt(tab.time_type, 10));
	if(tab.tab_type) {
		$("#stat-tab").css("display","none");
		$("#item-tab").css("display","block");
		var iname = tab.view ? 'drivers' : 'units';
		PLOT.resize();
		if(tab[iname].xhr)
			$("#overlay-tab").show();
		else
			$("#overlay-tab").hide();
		if (!MAP)
			initMap();

		showStatistic(tab_id);
		MAP.invalidateSize();
		$("#drivers_switcher").css("display","none");
	} else {
		$("#stat-tab").css("display","block");
		$("#item-tab").css("display","none");
		$("#overlay-tab").hide();
		showMenu(tab_id);
		$("#drivers_switcher").css("display","block");
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
			return "<b>" + f[0] + "</b> " + (date_only ? "" : f[1] + " &ndash; " + t[1]);
		else
			return "<b>" + f[0] + "</b> " + (date_only ? "" : f[1]) + " &ndash; <b>" +
				t[0] + "</b> " +(date_only ? "" : t[1]);
	} else
		return from + " &ndash; " + to;
}

/** Get time from the user input
 *
 *  @param {bool} is_send   if interval will be send directly to Wialon
 *  @returns {Array} [from, to] interval
 */
function get_time_from_input (is_send) {

    var period = +$('.interval-wialon-container .iw-select .iw-period-btn.active').attr('data-period');
    if ( period !== 4 ) {
        is_send = false;
    }
    var arr = $("#dateinterval").intervalWialon("get", is_send);

    var t0 = new Date(arr[0] * 1000);
    t0.setMinutes(0);
    var t1 = new Date(arr[1] * 1000);
    t1.setDate(t1.getUTCDate());
    t1.setMinutes(59);
    return [ (t0.setHours(0) / 1000), (t1.setHours(23) / 1000) ]
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
