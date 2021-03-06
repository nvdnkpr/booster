/*jslint node:true, nomen:true */
/*global unescape */

var fs = require('fs'), _ = require('lodash'), async = require('async'), 
modelFactory = require('./model'), controllerFactory = require('./controller'),
config, CONTROLLERS = './routes', MODELS = './models', reqLoader, textParser = require('./textParser'),
loadModel, loadController, trailSlash, trim, models = {}, controllers = {}, routes = {}, ctrlrRoutes = {
	base: {
		index: ["GET",false],
		show: ["GET",true],
		create: ["POST",false],
		update: ["PUT",true],
		patch: ["PATCH",true],
		destroy: ["DEL",true]
	},
	property: {
		getProperty: "GET",
		setProperty: "PUT"
	}
};

trailSlash = function (str) {
	return(str !== null && str !== undefined && typeof(str) === "string" && str.slice(-1) !== '/' ? str+'/' : str);
};
trim = function (str) {
	return((str||"").replace(/(^\s+|\s+$)/g,""));
};

reqLoader = function (req,res,next) {
	req.booster = {
		param : config.param,
		models : models,
		controllers : controllers
	};
	next();
};

loadModel = function(name,path,models,db) {
	var ret, module;
	/*jslint stupid:true */
	if (fs.existsSync(path+'.js')) {
    module = require(fs.realpathSync(path+'.js'));
		/*jslint stupid:false */
	} else {
		module = null;
	}
	ret = modelFactory.generate(name,models,db,module);
	return ret;
};
loadController = function(name,path,models,opts,config) {
	var ret, module;
	opts = opts || {};
	/*jslint stupid:true */
	if (fs.existsSync(path+name+'.js')) {
    module = require(fs.realpathSync(path+name+'.js'));
		/*jslint stupid:false */
	} else {
		module = null;
	}
	ret = controllerFactory.generate(name,module,opts);
	return ret;
};


module.exports = {
	init: function(conf) {
		config = _.extend({},conf);
		//booster.init({app:app,db:db,controllers:'./controllers',models:'./models'});
		// validate we have what we need
		config.controllers = trailSlash(config.controllers || CONTROLLERS);
		config.models = trailSlash(config.models || MODELS);
		config.param = config.param || {};
		config.base = config.base || "";
		// reset to be safe
		this.models = models = {};
		this.controllers = controllers = {};
		routes = {};
		
		// add the reqLoader
		conf.app.use(textParser);
		conf.app.use(reqLoader);
		
		return(this);
	},
	resource: function(name,opts) {
		// load and activate models and controllers for this resource, if they are available
		var m, c, app = config.app, basePath = "", adder = "", middleware = [reqLoader], processors = [];
		opts = opts || {};
		name = trim(name).replace(/^.*\//,"");
		if (name) {
			if (opts.parent) {
				basePath += routes[opts.parent] + "/:"+opts.parent + '/';
			} else if (opts.base) {
				basePath += opts.base;
			} else if (config.base) {
				basePath += config.base;
			}
			if (basePath.charAt(0) !== '/') {
				basePath = '/' + basePath;
			}
			if (basePath.slice(-1) !== '/') {
				basePath += '/';
			}
			if (!opts.root) {
				basePath += name;
				adder = '/';
			}
			models[name] = m = loadModel(name,config.models+name,models,config.db);
			controllers[name] = c = loadController(name,config.controllers,models,opts,config.param);
			routes[name] = basePath;
			
			// set up the middleware
			if (c.all && typeof(c.all) === "function") {
				middleware.push(c.all);
			}
			if (c.filter && c.filter.all && typeof(c.filter.all) === "function") {
				middleware.push(c.filter.all);
			}
			if (c.post && c.post.all && typeof(c.post.all) === "function") {
				processors.push(c.post.all);
			}
			// set up the routes using express routes
			_.each(ctrlrRoutes.base,function (route,method) {
				var verb = route[0].toLowerCase(), path = basePath+(route[1] ? adder+':'+name : ''), filter = (c.filter||{})[method],
				mw = [].concat(middleware,filter || []), post = (c.post||{})[method],
				pp = [].concat(processors,post || []);
				if (c[method] && typeof(c[method]) === "function") {
					app[verb](path,mw,function (req,res,next) {
						var r = res.send;
						res.send = function (status,body) {
							// undo what we did for res.send...
							res.send = r;
							if (pp && pp.length > 0) {
								async.each(pp,function(item,callback){
									item(req,res,callback,status,body);
								},function (err,data) {
									if (err) {
										next(err);
									} else {
										res.send(status,body);
									}
								});
							} else {
								res.send(status,body);
							}
						};
						c[method](req,res,next);
					});
				}
			});
			// special properties come first
			_.each(c.properties||{},function (handles,prop) {
				if (handles) {
					if (handles.get && typeof(handles.get) === "function") {
						app.get(basePath+adder+':'+name+'/'+prop,middleware,handles.get);
					}
					if (handles.set && typeof(handles.set) === "function") {
						app.put(basePath+adder+':'+name+'/'+prop,middleware,handles.set);
					}
				}
			});
			
			// and the special resource properties
			_.each(opts.resource,function (types,prop) {
				if (_.contains(types,"get")) {
					app.get(basePath+adder+':'+name+'/'+prop,middleware,function (req,res,next) {
						// get the instances of 'prop' where the value of the field for our name matches our ID
						var search = {};
						search[name] = req.params[name];
						req.booster.models[prop].find(search,function (err,data) {
							if (err) {
								res.send(400,err);
							} else if (data && _.size(data) > 0) {
								res.send(200,data);
							} else {
								next();
							}
						});
						
					});
				}
			});
			
			_.each(ctrlrRoutes.property,function (route,method) {
				var verb = route.toLowerCase();
				if (c[method] && typeof(c[method] === "function")) {
					app[verb](basePath+adder+":"+name+'/:prop123var',middleware,c[method]);
				}
			});
		}
		return(this);
	},
	model: function(name) {
		models[name] = loadModel(name,config.models+name,models,config.db);
	},
	validator: require('./validator').validate,
	models: models,
	controllers: controllers	
};
