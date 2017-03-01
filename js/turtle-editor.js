// see https://www.npmjs.com/package/github-client
// and http://getbootstrap.com/css/ (styles for prettiness)
// and http://codemirror.net/ (text editor with syntax highlighting)
// and https://github.com/RubenVerborgh/N3.js (Turtle parser)


define(['jquery', 'jqueryui', 'github', 'vis', 'underscore', 'N3', 'splitPane',
		'lib/codemirror', 'addon/hint/show-hint', 'addon/search/searchcursor',
		'addon/search/matchesonscrollbar', 'addon/scroll/annotatescrollbar',
		'mode/turtle/turtle', 'hint/turtle-hint', 'logger'],

function ($, JQueryUI, Github, vis, underscore, N3, SplitPane, CodeMirror, ShowHint, SearchCursor,
	MatchesOnScrollbar, AnnotateScrollbar, ModeTurtle, HintTurtle, logger) {

  // HTML elements ------------------------------------------------------------

	var menu =  $("#menu");

	var inputElements = {
  		username:	$("#input-username"),
		password:	$("#input-password"),
		owner:		$("#input-owner"),
		repo:		$("#input-repo"),
		branch:		$("#input-branch"),
		file:		$("#input-file"),
		contents:	$("#input-contents"),
		message:	$("#input-message"),
		load:		$("#button-load"),
		save:		$("#button-save"),
		fileDisp:	$(".current-filename"),
		vowlLink:	$("#webvowl-link"),
		ghLink:		$("#github-link"),
		sparqlURL:	$("#sparql-link")
	};

	var syntaxCheckElements = {
		checker: $("#syntax-check"),
		working: $("#syntax-check-working"),
		pending: $("#syntax-check-pending"),
		passed:  $("#syntax-check-passed"),
		failed:  $("#syntax-check-failed"),
		off:     $("#syntax-check-off")
	};

	var tabsList = '<ul id="tabs-list"> \
						<li><a href="#left-component">Graphical View</a></li> \
						<li><a href="#right-component">Code View</a></li> \
						<button type="button" id="split-button" class="button-style">Split view</button> \
						<input type="checkbox" id="freeze" class="menu-checkbox" style="margin-top:8px"> \
						<label class="menu-label" title="Disable the physics of the network">Freeze</label> \
						<input type="checkbox" id="hide-nodes" class="menu-checkbox" style="margin-top:8px"> \
						<label class="menu-label" title="Hide nodes from the RDF, RDFS and OWL vocabularies">Hide defaults</label> \
						<input type="image" id="decluster" src="img/minus.png" class="clustering-button" style="margin-right: 20px" /> \
						<input type="image" id="cluster" src="img/plus.png" class="clustering-button" style="margin-right: 10px" /> \
						<label class="menu-label">Clustering</label> \
					</ul>';

	// Editor state -------------------------------------------------------------

	var isBinary = false;

	var gh, repo, branch, user;
	var currentFile;

	var state = {
		syntaxCheck: "pending",
		fileIsLoaded: false,
		gh: undefined,
		repo: undefined,
		branch: undefined,
		user: undefined,
		currentFile: undefined
	};

	var editor = CodeMirror.fromTextArea(inputElements.contents[0], { 
		mode:        "turtle",
		autofocus:   false,
		lineNumbers: true,
		gutters:     ["CodeMirror-linenumbers", "breakpoints"],
		extraKeys: { "Ctrl-Space": "autocomplete" }
	});

	// trick to prevent re-updating the graphical view 
	// when the code view was updated due to a graphical change
	var changeFromSync = false;

	var labelMaxLength = 15;
	
	var scrollbarMarks;
	var textMarks = [];

	var network;

	var oldTriples = [];
	var newTriples = [];

	var defaultPrefixes = ["rdf", "rdfs", "owl"];
	var basePrefix = "";
	var hidden = true;
	var freeze = false;

	editor.custom = {}; // to pass list of prefixes and names
	editor.custom.dynamicNames = {};
	editor.custom.prefixes = {};
	var dynamicNames = {};

	CodeMirror.commands.autocomplete = function(cm) {
		cm.showHint(cm, CodeMirror.hint.turtle, {test: "test"});
	};

	// Reenable input element (necessary for Firefox)
	for (var key in inputElements) {
		inputElements[key].prop("disabled", false);
	}

	// Prefill some fields for a quick example
	inputElements.owner.val("vocol");
	inputElements.repo.val("mobivoc");
	// inputElements.password.val("token");

	// Clustering ---------------------------------------------------------------

	var clusterIndex = 0;
	var clusters = [];
	var clusterLevel = 0;

	function getClusterLabel(node) {
		var clusterLabel = node.title != null ? node.title : node.label;
		var endl = clusterLabel.indexOf("\n");

		if (endl != -1)
			clusterLabel = clusterLabel.substring(0, endl);

		return clusterLabel;
	}

	// make the clusters
	function makeClusters() {
		clusterLevel = clusterLevel + 1;

		var clusterOptionsByData = {
			processProperties: function (clusterOptions, childNodes) {
				clusterIndex = clusterIndex + 1;
				var childrenCount = 0;
				for (var i = 0; i < childNodes.length; i++) {
					childrenCount += childNodes[i].childrenCount || 1;
				}

				// get subject node
				var subjectNode;
				for (var i = 0; i < childNodes.length; i++) {
					var conn = network.getConnectedNodes(childNodes[i].id);
					if (conn.length == 1) {
						subjectNode = network.body.data.nodes.get(conn[0]);

						if (subjectNode == null)
							subjectNode = clusters.filter(function (c) { return c.id == conn[0]; })[0];
						break;
					}
				}

				clusterOptions.childrenCount = childrenCount;
				clusterOptions.size = childrenCount * 4 + 15;
				clusterOptions.label = getClusterLabel(subjectNode) + "\n(" + childrenCount + " nodes)";
				clusterOptions.id = 'cluster:' + clusterIndex;
				clusterOptions.mass = 0.5 * childrenCount;

				clusters.push({ id: 'cluster:' + clusterIndex, label: clusterOptions.label, clusterLevel: clusterLevel });

				return clusterOptions;
			},
			clusterNodeProperties: {
				borderWidth: 2,
				shape: 'dot',
				color: { background: '#ffce99', border: '#ff9c33', highlight: { background: '#ffe6cc', border: '#ffb566' } }
			}
		}

		network.clusterOutliers(clusterOptionsByData);

		if (clusters.length > 0)
			clusterLevel = clusters[clusters.length - 1].clusterLevel;

		//if (document.getElementById('stabilizeCheckbox').checked === true) {
		//	// since we use the scale as a unique identifier, we do NOT want to fit after the stabilization
		//	network.setOptions({ physics: { stabilization: { fit: false } } });
		//	network.stabilize();
		//}
	}

	// open them back up!
	function openClusters() {
		var newClusters = [];
		var declustered = false;
		decluster:
		for (var i = 0; i < clusters.length; i++) {
			if (clusters[i].clusterLevel >= clusterLevel) {
				network.openCluster(clusters[i].id);
				declustered = true;
			}
			else {
				newClusters.push(clusters[i])
			}
		}
		clusters = newClusters;

		if (declustered)
			clusterLevel = clusterLevel - 1;
		else if (clusterLevel > 0) {
			clusterLevel = clusterLevel - 1;
			openClusters();
		}		

		//if (declustered === true && document.getElementById('stabilizeCheckbox').checked === true) {
		//	// since we use the scale as a unique identifier, we do NOT want to fit after the stabilization
		//	network.setOptions({ physics: { stabilization: { fit: false } } });
		//	network.stabilize();
		//}
	}

	// Github Interaction -------------------------------------------------------
  
	var loadFromGitHub = function () {
		var username = inputElements.username.val().trim();
		var ownername = inputElements.owner.val().trim();
		var password = inputElements.password.val().trim();
		var reponame = inputElements.repo.val().trim();
		var branchname = inputElements.branch.val().trim();

		if (state.fileIsLoaded) {
    		logger.info("File already loaded.");
		}
		else {
    		if (username != "") {
    			gh = new Github({
    				username: username,
    				password: password
    			});
    		}
    		else {
    			gh = new Github({
    				token: password
    			});
    		}

    		user = gh.getUser();
    		logger.debug("user", user);

    		if (!user) {
    			logger.warning("Not logged in.", username);
    		}

    		repo = gh.getRepo(ownername, reponame);
    		branch = repo.getBranch(branchname);

    		// TODO:
    		// the next call is redundant: branch already contains list of files,
    		// and this should not be "master" but the selected branch:
    		var tree = repo.git.getTree("master", null)
				.done(function (tree) {
					for (var i = 0; i < tree.length; i++) {
						if (tree[i].path.endsWith(".ttl")) {
							var opt = tree[i].path;
							var el = document.createElement("option");
							el.textContent = opt;
							el.value = opt;
							inputElements.file.append(el);
						}
					}
					readFile();
				});

    		inputElements.username.prop("disabled", true);
    		inputElements.password.prop("disabled", true);
    		inputElements.owner.prop("disabled", true);
    		inputElements.repo.prop("disabled", true);
    		inputElements.branch.prop("disabled", true);

    		disableLoadButton();

    		changeSyntaxCheckState("pending");
		}
	};

	var idExists = function (arr, val) {
		for (var i = 0; i < arr.length; i++) {
			if (arr[i].id == val)
				return true;
		}

		return false;
	}

	var readFile = function () {
		var filename = inputElements.file.val()

		branch.read(filename, isBinary)
			.done(function(contents) {
				editor.setValue(contents.content);
				state.fileIsLoaded = true;
				displayCurrentFilename(filename);
        
				if (user) {
				  enableSaveButton();
				}    

			})
			.fail(function(err) {
				logger.error("Read from GitHub failed", err);
			});

		changeSyntaxCheckState("pending");
	};

	var storeToGitHub = function () {
		var filename = inputElements.file.val();
		var content = editor.getValue().trim();
		var message = inputElements.message.val().trim();

		if (state.fileIsLoaded) {
			branch.write(filename, content, message, isBinary)
				.done(function() {
					logger.success("Saving to GitHub completed.")
				})
				.fail(function(err) {
					logger.error("Saving to GitHub failed.", err);
				});
		}
		else {
		  logger.info("Nothing to save.");
		}
	};

	// Display current filename -------------------------------------------------

	var displayCurrentFilename = function (filename) {
		var baseUri = "http://vowl.visualdataweb.org/webvowl/index.html#iri=https://raw.githubusercontent.com/";
		var ownername = inputElements.owner.val().trim();
		var reponame = inputElements.repo.val().trim();
		var branchname = inputElements.branch.val().trim();
		var specific = ownername + "/" + reponame + "/" + branchname;
		inputElements.fileDisp.html(filename)
		inputElements.vowlLink.removeAttr("href");
		inputElements.vowlLink.attr("href", baseUri + specific + "/" + filename);

		// external links //////////////////////////
		var githubURI = "https://github.com";
		inputElements.ghLink.attr("href", githubURI + "/" + ownername + "/" + reponame + "/");
		var sparqlProcessorURI = "../SparqlProcessor/sparql-processor.html";

		inputElements.sparqlURL.attr("href", sparqlProcessorURI + "#" + ownername + "/" + reponame + "/" + filename);
		$("#menu").show();
	};

	// "http://vowl.visualdataweb.org/webvowl/index.html#iri=https://raw.githubusercontent.com/mobivoc/mobivoc/master/"
  
	// Syntax Check -------------------------------------------------------------

	var makeMarker = function (errorMessage) {
		var marker = document.createElement("div");
		marker.style.color = "#822";
		marker.innerHTML = "●";
		marker.title = errorMessage;
		return marker;
	};

	var splitIntoNamespaceAndName = function (s) {
		var lastHash = s.lastIndexOf("#");
		var lastSlash = s.lastIndexOf("/");
		var pos = Math.max(lastHash, lastSlash) + 1;

		return {
			namespace: s.substring(0, pos),
			name:      s.substring(pos)
		};
	};

	var parserHandler = function (error, triple, prefixes) {
		if (error) {
			/* extract line Number, only consider the end of the string after "line" */
			var errorSubString = error.message.substr(error.message.indexOf("line")+4);
			var errorLineNumber = parseInt(errorSubString) -1;

			/* add background color, gutter + tooltip */
			editor.getDoc().addLineClass(errorLineNumber, "wrap", "ErrorLine-background");
			editor.setGutterMarker(errorLineNumber, "breakpoints", makeMarker(error.message));

			changeSyntaxCheckState("failed", error.message);
		}
		else if (triple) {
			newTriples.push(triple);

			var subjectSplit = splitIntoNamespaceAndName(triple.subject);
			var predicateSplit = splitIntoNamespaceAndName(triple.predicate);
			var objectSplit = splitIntoNamespaceAndName(triple.object);

			dynamicNames[subjectSplit.namespace] = dynamicNames[subjectSplit.namespace] || {};
			dynamicNames[subjectSplit.namespace][subjectSplit.name] = true;

			dynamicNames[predicateSplit.namespace] = dynamicNames[predicateSplit.namespace] || {};
			dynamicNames[predicateSplit.namespace][predicateSplit.name] = true;

			dynamicNames[objectSplit.namespace] = dynamicNames[objectSplit.namespace] || {};
			dynamicNames[objectSplit.namespace][objectSplit.name] = true;
		}
		else if (!triple) {
			changeSyntaxCheckState("passed"); 
			editor.custom.dynamicNames = dynamicNames;

			if (prefixes) 
				editor.custom.prefixes = prefixes;

			updateGraphicalView();
		} 
	};

	var changeSyntaxCheckState = function (newState, error, force) {
		if (newState !== state.syntaxCheck && (state.syntaxCheck !== "off" || force === true)) {
			console.log("changeSyntaxCheckState", newState, error, force);
			syntaxCheckElements[state.syntaxCheck].hide();
			state.syntaxCheck = newState;

			if (newState === "failed") {
				var status = syntaxCheckElements[newState].find(".status")
				if (error) {
					if (error.startsWith("Syntax error:")) {
						status.html(" " + error);
					}
					else {
						status.html(" Syntax error: " + error);
					}
				}
				else {
					status.html(" Syntax check failed.")
				}
			}

			syntaxCheckElements[newState].show();
		}
	};

	var checkSyntax = function () {
		/* remove all previous errors  */
		/* TODO: IMPROVE EFFICIENCY */ 
		editor.eachLine(function(line) { 
			editor.getDoc().removeLineClass(line, "wrap");
			editor.clearGutter("breakpoints");
		});

		var parser, content;
		//if (state.fileIsLoaded) {
			content = editor.getValue();
			parser  = N3.Parser();
			parser.parse(content, parserHandler);
		//}
	};

	var checkForUpdates = function () {
		if (state.syntaxCheck === "pending" && (state.fileIsLoaded || editor.getValue() != "")) {
			changeSyntaxCheckState("working");
			checkSyntax();
		}
	};

	function clearPopUp() {
		document.getElementById('saveButton').onclick = null;
		document.getElementById('cancelButton').onclick = null;
		document.getElementById('network-popUp').style.display = 'none';
	}

	function cancelEdit(callback) {
		clearPopUp();
		callback(null);
	}

	// Visualization ---------------------------------------------------------

	var clearMarks = function() {
		if (scrollbarMarks != null) {
			scrollbarMarks.clear();
			scrollbarMarks = null;
		}
		
		textMarks.forEach(function (tm) {
			tm.clear();
		});
		textMarks = [];
	}
	
	var shrinkPrefix = function (iri) {
		for (var ns in editor.custom.prefixes) {
			var prefix = editor.custom.prefixes[ns];
			if (iri.indexOf(prefix) === 0) {
				if (prefix !== '') {
					var suffix = iri.split(prefix)[1];
					return ns + ":" + suffix;
				}
			}
		}

		return iri;
	}

	var getPreparedNode = function (id, type) {
		var node = {}
		var label = shrinkPrefix(id);
		if (label.length > labelMaxLength) {
			var title = label;
			label = label.substr(0, labelMaxLength - 1) + "...";
			node = { id: id, label: label, type: type, title: title };
		}
		else
			node = { id: id, label: label, type: type };

		if (N3.Util.isLiteral(id)) {
			node.shape = 'box';
			node.shapeProperties = {};
			node.shapeProperties.borderDashes = [5, 5];
			node.color = { background: 'yellow', border: 'black', highlight: { background: '#F2F59D', border: 'red' } };
		}

		return node;
	}

	var initializeGraphicalView = function (physicsEnabled) {
		var nodes = [];
		var edges = [];

		var triples = N3.Store();
		triples.addTriples(newTriples);

		triples.find().forEach(function (t) {
			var subject = t.subject.toString();
			var predicate = t.predicate.toString();
			var object = t.object.toString();

			if (!idExists(nodes, subject)) {
				nodes.push(getPreparedNode(subject, "subject"));
			}
			if (!idExists(nodes, object)) {
				nodes.push(getPreparedNode(object, "object"));
			}

			edges.push({ from: subject, to: object, label: shrinkPrefix(predicate), type: "predicate", arrows: "to" });
		});

		var container = document.getElementById('left-component');
		var data = {
			nodes: nodes,
			edges: edges
		};
		var options = {
			manipulation: {
				addNode: function (data, callback) {
					// filling in the popup DOM elements
					document.getElementById('operation').innerHTML = "Add Node";
					$("#label").tooltip("enable");
					document.getElementById('label').value = data.label;
					document.getElementById('saveButton').onclick = saveNode.bind(this, data, callback);
					document.getElementById('cancelButton').onclick = clearPopUp.bind();
					document.getElementById('network-popUp').style.display = 'block';
				},
				editNode: function (data, callback) {
					// filling in the popup DOM elements
					document.getElementById('operation').innerHTML = "Edit Node";
					$("#label").tooltip("disable");
					document.getElementById('label').value = data.title != null ? data.title : data.label;
					document.getElementById('saveButton').onclick = saveNode.bind(this, data, callback);
					document.getElementById('cancelButton').onclick = cancelEdit.bind(this, callback);
					document.getElementById('network-popUp').style.display = 'block';
				},
				deleteNode: function (data, callback) {
					$("#dialog").dialog({
						dialogClass: "no-close",
						buttons: {
							YES: function () { $(this).dialog("close"); delNode(data, true, callback); },
							NO: function () { $(this).dialog("close"); delNode(data, false, callback); },
							cancel: function () { $(this).dialog("close"); callback(); }
						}
					}).css("display", "block");
				},
				addEdge: function (data, callback) {
					document.getElementById('operation').innerHTML = "Add Edge";
					$("#label").tooltip("disable");
					document.getElementById('label').value = "new";
					document.getElementById('saveButton').onclick = saveEdge.bind(this, data, callback);
					document.getElementById('cancelButton').onclick = clearEdge.bind(this, data);
					document.getElementById('network-popUp').style.display = 'block';

					if (data.from == data.to) {
						var r = confirm("Do you want to connect the node to itself?");
						if (r == true) {
							callback(data);
						}
						clearPopUp();
					}
					else {
						callback(data);
					}
				},
				editEdge: function (data, callback) {
					// filling in the popup DOM elements
					document.getElementById('operation').innerHTML = "Edit Edge";
					$("#label").tooltip("disable");
					document.getElementById('label').value = data.label;
					document.getElementById('saveButton').onclick = saveEdge.bind(this, data, callback);
					document.getElementById('cancelButton').onclick = cancelEdit.bind(this, callback);
					document.getElementById('network-popUp').style.display = 'block';
				},
				deleteEdge: function (data, callback) {
					$("#dialog").dialog({
						dialogClass: "no-close",
						buttons: {
							YES: function () { $(this).dialog("close"); delEdge(data, true, callback); },
							NO: function () { $(this).dialog("close"); delEdge(data, false, callback); },
							cancel: function () { $(this).dialog("close"); callback(); }
						}
					}).css("display", "block");
				}
			},
			physics: {
				enabled: physicsEnabled,
				barnesHut: { gravitationalConstant: -2500, springConstant: 0.001, springLength: 50 }
			},
			edges: { smooth: { type: 'continuous' } }
		};

		network = new vis.Network(container, data, options);

		network.on("click", function (params) {
			if (params.nodes.length == 1) {
				if (network.isCluster(params.nodes[0]) == true) { // if the node is a cluster, we open it up
					network.openCluster(params.nodes[0])

					for (var i = 0; i < clusters.length; i++)
						if (clusters[i].id == params.nodes[0]) {
							clusters.splice(i, 1);
							break;
						}
				}
				else { // if the node is not a cluster, we highlight its matches in the code view
					var nodeID = shrinkPrefix(params.nodes[0]);
					var query = new RegExp(nodeID + '(?![A-Za-z0-9_-])');
					var cursor = editor.getDoc().getSearchCursor(query);
					var res = cursor.findNext();

					var doc = editor.getDoc();
					if (res)
						doc.setCursor(cursor.pos.from.line);
					
					clearMarks();
					scrollbarMarks = editor.showMatchesOnScrollbar(query, true, "highlight-scrollbar");
					while(res) {
						textMarks.push(doc.markText(cursor.pos.from, cursor.pos.to, {className: "highlight"}));
						res = cursor.findNext();
					}
				}
			}
			else
				clearMarks();
		});
	}

	// Syncronization --------------------------------------------------------

	function getBasePrefix() {
		var cursor = editor.getDoc().getSearchCursor("@base");
		var res = cursor.findNext();

		var line = "";
		if (res) {
			line = editor.getDoc().getLine(cursor.pos.from.line);

			var startPos = line.indexOf("<");
			var endPos = line.indexOf(">");

			if (startPos > -1 && endPos > -1)
				basePrefix = line.substring(startPos + 1, endPos);
		}
		else
			basePrefix = "";
	}

	function triplesEqual(t1, t2) {
		return t1.subject == t2.subject && t1.predicate == t2.predicate && t1.object == t2.object;
	}

	function deleteTripleFromArray(arr, t) {
		for (var i = 0; i < arr.length; i++)
			if (triplesEqual(arr[i], t)) {
				arr.splice(i, 1);
				break;
			}
	}

	function insertTripleIntoArray(arr, t) {
		for (var i = 0; i < arr.length; i++)
			if (arr[i].subject == t.subject) {
				while (i < arr.length && arr[i].subject == t.subject) { i++; }
				arr.splice(i, 0, t);
				return;
			}

		arr.push(t);
	}

	// what = "subject" or "predicate" or "object"
	function updateTripleOfArray(arr, oldTriple, newItem, what) {
		for (var i = 0; i < arr.length; i++)
			if (triplesEqual(arr[i], oldTriple)) {
				if (what == "subject")
					arr[i].subject = newItem;
				else if (what == "predicate")
					arr[i].predicate = newItem;
				else if (what == "object")
					arr[i].object = newItem;
				break;
			}
	}

	function triplesToTurtle() {
		changeFromSync = true;
		var current_cursor = editor.getDoc().getCursor();

		getBasePrefix();

		var writer = N3.Writer({ prefixes: editor.custom.prefixes });
		writer.addTriples(oldTriples);
		writer.end(function (error, result) { editor.setValue(result); });

		if (basePrefix != "") {
			var cursor = editor.getDoc().getSearchCursor("@prefix");
			var res = cursor.findNext();

			var line = 0;
			while (res) {
				line = cursor.pos.from.line;
				res = cursor.findNext();
			}

			editor.getDoc().replaceRange("@base <" + basePrefix + "> .\n", { line: line + 1, ch: 0 });
		}

		editor.getDoc().setCursor(current_cursor);
	}

	function triplesDiff(a1, a2) {
		return a1.find().filter(function (x) { return a2.find(x.subject, x.predicate, x.object).length == 0; });
	}

	function saveNode(data, callback) {
		//var start = new Date().getTime();
		var label = shrinkPrefix(document.getElementById('label').value);
		var id = "";
		
		try {
			id = N3.Util.expandPrefixedName(label, editor.custom.prefixes);
		}
		catch(err) {
			alert(err + ". Hint: The prefix has to be defined in the code view.");
			return;
		}
		
		var existing = network.body.data.nodes.get(id);
		if (existing != null) {
			alert("A node with this label already exists!");
			return;
		}

		var node = network.body.data.nodes.get(data.id);
		if (node != null) { // update existing node (this assumes actually deleting the 
							// existing node and adding another one with the new id)
			var connectedEdges = network.getConnectedEdges(node.id);

			node.id = id;
			if (label.length > labelMaxLength) {
				node.title = label;
				node.label = label.substr(0, labelMaxLength - 1) + "...";
			}
			else {
				node.label = label;
			}

			network.body.data.nodes.add(node);
			connectedEdges.forEach(function (e) {
				var edge = network.body.data.edges._data[e];
				if (edge.from == data.id) {
					//------ code view update -------
					updateTripleOfArray(oldTriples,
										{ subject: edge.from, predicate: N3.Util.expandPrefixedName(edge.label, editor.custom.prefixes), object: edge.to },
										id,
										"subject");
					triplesToTurtle();
					//-------------------------------

					network.body.data.edges.update({ id: e, from: id });
				}
				else {
					//------ code view update -------
					updateTripleOfArray(oldTriples,
										{ subject: edge.from, predicate: N3.Util.expandPrefixedName(edge.label, editor.custom.prefixes), object: edge.to },
										id,
										"object");
					triplesToTurtle();
					//-------------------------------

					network.body.data.edges.update({ id: e, to: id });
				}
			});

			network.body.data.nodes.remove(data.id);
		}
		else { // add new node
			if (label.indexOf(":") == -1) { // if no prefix is provided, we prepend the base prefix
				getBasePrefix();
				id = basePrefix + label;
			}
			var node = getPreparedNode(id, "");
			node.x = data.x;
			node.y = data.y;
			callback(node);
		}

		clearPopUp();

		//var end = new Date().getTime();
		//var time = end - start;
		//alert('Execution time: ' + time);
	}

	function clearEdge(data) {
		var label = document.getElementById('label').value;
		clearPopUp();

		var items = network.body.data.edges.get({
			filter: function (elem) {
				return (elem.from == data.from && elem.to == data.to && elem.label == data.label);
			}
		});

		if (items.length > 0)
			network.body.data.edges.remove(items[0]);
	}

	function saveEdge(data, callback) {
		var label = document.getElementById('label').value;
		clearPopUp();
		
		var items = network.body.data.edges.get({
			filter: function (elem) {
				return (elem.from == data.from && elem.to == data.to && elem.label == data.label);
			}
		});

		if (items.length > 0) {
			var newEdge = false;
			if (items[0].label == null) {
				newEdge = true;

				if (N3.Util.isLiteral(data.from)) {
					window.alert("A literal cannot be subject!");
					network.body.data.edges.remove(items[0]);
					return;
				}

				// check if a new node is connected and also set its type (subject or object)
				if (network.getConnectedEdges(data.from).length == 1) // 1 because the edge was already added (without a label)
					network.body.data.nodes.update({ id: data.from, type: "subject" })
				if (network.getConnectedEdges(data.to).length == 1)
					network.body.data.nodes.update({ id: data.to, type: "object" })
			}

			if (label.indexOf(":") == -1) { // if no prefix is provided, we prepend the base prefix
				getBasePrefix();
				label = shrinkPrefix(basePrefix + label);
			}

			network.body.data.edges.remove(items[0]);
			network.body.data.edges.add({ from: data.from, to: data.to, label: label, type: "predicate", arrows: "to" });

			// update the code view

			if (newEdge) {
				var addTriple = {};
				addTriple.subject = data.from;
				addTriple.predicate = N3.Util.expandPrefixedName(label, editor.custom.prefixes);
				addTriple.object = data.to;

				insertTripleIntoArray(oldTriples, addTriple);
			}
			else {
				updateTripleOfArray(	oldTriples, 
										{ subject: data.from, predicate: N3.Util.expandPrefixedName(data.label, editor.custom.prefixes), object: data.to },
										N3.Util.expandPrefixedName(label, editor.custom.prefixes), 
										"predicate");
			}

			triplesToTurtle();
		}
	}

	function delEdge(data, del, callback) {
		var edge = network.body.data.edges._data[data.edges[0]];

		if (del) { // delete also the nodes that will remain unconnected
			if (edge != null) {
				if (network.getConnectedEdges(edge.from).length <= 1)
					data.nodes.push(edge.from);
				if (network.getConnectedEdges(edge.to).length <= 1)
					data.nodes.push(edge.to);
			}
		}

		callback(data);

		// update the code view

		var deleteTriple = {};
		deleteTriple.subject = edge.from;
		deleteTriple.predicate = N3.Util.expandPrefixedName(edge.label, editor.custom.prefixes);
		deleteTriple.object = edge.to;

		deleteTripleFromArray(oldTriples, deleteTriple);

		triplesToTurtle();
	}

	function delNode(data, del, callback) {
		var node = network.body.data.nodes._data[data.nodes[0]];
		
		if (del) { // delete also the neighbours that will remain unconnected
			if (node != null) {
				var neighbours = network.getConnectedNodes(node.id);

				for (var i = 0; i < neighbours.length; i++)
					if (network.getConnectedEdges(neighbours[i]).length <= 1)
						data.nodes.push(neighbours[i]);
			}
		}

		// ----- update the code view -------------------------------
		data.edges.forEach(function (e) {
			var edge = network.body.data.edges._data[e];

			var deleteTriple = {};
			deleteTriple.subject = edge.from;
			deleteTriple.predicate = N3.Util.expandPrefixedName(edge.label, editor.custom.prefixes);
			deleteTriple.object = edge.to;

			deleteTripleFromArray(oldTriples, deleteTriple);
		});

		triplesToTurtle();
		// ----------------------------------------------------------

		callback(data);
	}

	var updateGraphicalView = function () {
		if (oldTriples.length == 0) {
			initializeGraphicalView(true);

			if (newTriples.length > 500)
				makeClusters();
			if (newTriples.length > 1000)
				makeClusters();
			
			hidden = true;
			toggle_hide_defaults();
			document.getElementById("hide-nodes").checked = true;
		}
		else {
			var a1 = N3.Store();
			a1.addTriples(oldTriples);
			var a2 = N3.Store();
			a2.addTriples(newTriples);
			var diffOld = triplesDiff(a1, a2);          
			var diffNew = triplesDiff(a2, a1);                
          
			// remove the old SPOs
			diffOld.forEach(function (e) {
				var s = network.body.data.nodes.get(e.subject);
				var o = network.body.data.nodes.get(e.object);

				if (s != null) {
					var edgesNo = network.getConnectedEdges(e.subject).length;
					if (edgesNo <= 1)
						network.body.data.nodes.remove(s);
				}

				if (o != null) {
					var edgesNo = network.getConnectedEdges(e.object).length;
					if (edgesNo <= 1)
						network.body.data.nodes.remove(o);
				}

				predicate_label = shrinkPrefix(e.predicate);
				var p = network.body.data.edges.get({
					filter: function (elem) {
						return (elem.label == predicate_label && elem.from == e.subject && elem.to == e.object);
					}
				});

				if (p.length > 0)
					network.body.data.edges.remove(p[0]);
			});

			// add the new SPOs
			diffNew.forEach(function (e) {
				if (network.body.data.nodes.get(e.subject) == null)
					network.body.data.nodes.add(getPreparedNode(e.subject, "subject"));
				if (network.body.data.nodes.get(e.object) == null)
					network.body.data.nodes.add(getPreparedNode(e.object, "object"));

				var items = network.body.data.edges.get({
					filter: function (elem) {
						return (elem.label == shrinkPrefix(e.predicate) && elem.from == e.subject && elem.to == e.object);
					}
				});
				if (items.length == 0)
					network.body.data.edges.add({ from: e.subject, to: e.object, label: shrinkPrefix(e.predicate), type: "predicate", arrows: "to" });
			});
		}

		oldTriples = newTriples.slice();
		newTriples = [];
	};
  
	$(window).ready(function () {
		$("#tabs").tabs({
			active: 1
		});
		$("#tabs").css("visibility", "visible");

		$("#label").tooltip();

		initializeGraphicalView(true);
	});

	// Event listeners ----------------------------------------------------------

	inputElements.load.on("click", loadFromGitHub);
	inputElements.save.on("click", storeToGitHub);
	inputElements.file.on("change", readFile);

	editor.on("change", function (editor, ch) {
		if (changeFromSync) {
			changeFromSync = false;
			return;
		}

		if (ch.origin == "setValue") {
			oldTriples = [];
			newTriples = [];
			
			hidden = false;
			
			clusterIndex = 0;
			clusters = [];
			clusterLevel = 0;
		}

		changeSyntaxCheckState("pending");
	});

	 editor.on("cursorActivity", function (editor) {
		 //var lineNumber = editor.getDoc().getCursor().line;
		 //var content = editor.getDoc().getLine(lineNumber);
	 	clearMarks();
	 });

	function getAbbreviatedNamespace(str) {
		var ind = str.indexOf(":");

		if (ind != -1)
			return str.substring(0, ind);

		return "";
	}

	function toggle_hide_defaults() {
		var lev = clusterLevel;
		while (clusterLevel > 0)
			openClusters();

		for (var key in network.body.nodes) {
			if (defaultPrefixes.indexOf(getAbbreviatedNamespace(network.body.nodes[key].labelModule.lines[0])) != -1) {
				network.body.nodes[key].options.hidden = hidden;
				network.getConnectedEdges(key).forEach(function (e) {
					network.body.edges[e].options.hidden = hidden;
				});
			}
		}

		network.body.emitter.emit('_dataChanged');

		clusterLevel = 0;
		for (var i = 0; i < lev; i++) {
			makeClusters();
		}
	}

	$("#tabs").on("click", "#hide-nodes", function () {
		hidden = !hidden;
		toggle_hide_defaults();
	});

	function toggle_freeze() {
		network.stopSimulation();
		network.physics.options.enabled = !freeze;
		network.startSimulation();
	}

	$("#tabs").on("click", "#freeze", function () {
		freeze = !freeze;
		toggle_freeze();
	});

	$("#tabs").on("click", "#cluster", function () {
		makeClusters();
	});

	$("#tabs").on("click", "#decluster", function () {
		openClusters();
	});

	$("#tabs").on("click", "#split-button", function () {
		$("#git-form").toggle();

		$("#tabs").tabs("destroy");
		$('#tabs-list').remove();

		var classes = $("#tabs").attr("class").split(" ");
		if (classes.indexOf("col-md-9") > -1) {
			$("#tabs").removeClass("col-md-9");
			$("#tabs").addClass("col-md-12");
		}

		$("#tabs").addClass("split-pane");
		$("#tabs").addClass("fixed-left");

		$('#tabs').height(530);
		$('#left-component').css("width", "45em")

		$('#divider').css("visibility", "visible");
		$('#tabs').splitPane();

		$('#back-div').css("display", "block");
	});

	$("#unsplit-button").click(function () {
		$("#git-form").toggle();

		var classes = $("#tabs").attr("class").split(" ");
		if (classes.indexOf("col-md-12") > -1) {
			$("#tabs").removeClass("col-md-12");
			$("#tabs").addClass("col-md-9");
		}

		if (classes.indexOf("split-pane") > -1) {
			$("#tabs").removeClass("split-pane");
		}

		if (classes.indexOf("fixed-left") > -1) {
			$("#tabs").removeClass("fixed-left");
		}

		$("#tabs").prepend(tabsList);
		$("#tabs").tabs({
			active: 1
		});

		$('#tabs').height(580);
		$('#left-component').css("width", "auto")

		$('div.split-pane-divider').css("visibility", "hidden");
		$('#back-div').css("display", "none");

		if (hidden)
			$('#hide-nodes').attr('checked', true);

		if (freeze)
			$('#freeze').attr('checked', true);

		toggle_hide_defaults();
		toggle_freeze();
	});

	// Repeated actions ---------------------------------------------------------
  
	window.setInterval(checkForUpdates, 1000);

	// Utility ------------------------------------------------------------------
  
	var disableLoadButton = function () {
		inputElements.load.removeClass("btn-primary");
		inputElements.load.addClass("btn-default");
		inputElements.load.prop("disabled", true);
	};

	var enableSaveButton = function () {
		inputElements.save.removeClass("btn-default");
		inputElements.save.addClass("btn-primary");
		inputElements.save.prop("disabled", false);
	};
  
	var disableSaveButton = function () {
		inputElements.save.addClass("btn-default");
		inputElements.save.removeClass("btn-primary");
		inputElements.save.prop("disabled", true);
	};

	// do it
	disableSaveButton();
  
	if (!String.prototype.endsWith) {
		String.prototype.endsWith = function(searchString, position) {
			var subjectString = this.toString();
			if (position === undefined || position > subjectString.length) {
				position = subjectString.length;
			}
			position -= searchString.length;
			var lastIndex = subjectString.indexOf(searchString, position);
			return lastIndex !== -1 && lastIndex === position;
		};
  }

	if (!String.prototype.startsWith) {
		String.prototype.startsWith = function(searchString, position) {
			position = position || 0;
			return this.indexOf(searchString, position) === position;
		};
	}
});
