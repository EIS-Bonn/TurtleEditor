var require = {
  baseUrl: 'js',
  paths: {
    mode: '../mode',
    N3: 'lib/n3-browser-slk',
    jquery: 'lib/jquery-2.1.3.min',
    jqueryui: 'lib/jquery-ui',
    github: 'lib/github',
    vis: 'lib/vis',
    underscore: 'lib/underscore-min',
    splitPane: 'lib/split-pane',
    waitSeconds: 0
  }, 
  shim: { // see http://requirejs.org/docs/api.html#config-shim
    'N3': {
      exports: 'N3'
    },
	'splitPane': {
		deps: ['jquery']
	}
  }
};
