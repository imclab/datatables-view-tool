// datatables-tool.js

var escapeSQL = function(column_name) {
  return '"' + column_name.replace(/"/g, '""') + '"'
}

// Function to map JSON data between DataTables format and ScraperWiki's SQL endpoint format.
// It returns a function for the fnServerData parameter
var convertData = function(table_name, column_names) {
  // This is a wrapper round the GET request DataTables makes to get more data
  // sSource - the URL, we don't use it, we hard code it instead
  // aoData - contains the URL parameters, e.g. what page, what to filter, what order and so on
  // fnCallback - where to call with the data you get back
  // oSettings - settings object for the whole DataTables, see http://datatables.net/docs/DataTables/1.9.0/DataTable.models.oSettings.html
  return function ( sSource, aoData, fnCallback, oSettings ) {
    // convert aoData into a normal hash (called ps)
    var params = {}
    for (var i=0;i<aoData.length;i++) { 
      params[aoData[i].name] = aoData[i].value
    }
    console.log("DataTables params:", params)

    // construct SQL query needed according to the parameters
    var columns  = _.map(column_names, escapeSQL).join(",")
    var order_by = ""
    if (params.iSortingCols >= 1) {
      var order_parts = []
      for (var i = 0; i < params.iSortingCols; i++) { 
        order_part = escapeSQL(column_names[params["iSortCol_" + i]])
        if (params["sSortDir_" + i] == 'desc') {
          order_part += " desc"
        } else if (params["sSortDir_" + i] != 'asc') {
          scraperwiki.alert("Got unknown sSortDir_" + i + " value in table " + table_name)
        }
        order_parts.push(order_part)
      }
      order_by = " order by " + order_parts.join(",")
    } 
    var where = ""
    if (params.sSearch) {
      // XXX no idea if this bog standard Javascript escape really does what we want with SQL databases.
      // There's no security risk (as endpoint is sandboxed). There could be user experience pain though.
      var search = "'%" + escape(params.sSearch.toLowerCase()) + "%'"
      where = " where " + _.map(column_names, function(n) { return "lower(" + escapeSQL(n) + ") like " + search }).join(" or ")
    }
    var query = "select " + columns + 
           " from " + escapeSQL(table_name) + 
         where + 
         order_by + 
           " limit " + params.iDisplayLength + 
           " offset " + params.iDisplayStart 
    console.log("SQL query:", query)

    // get column counts
    scraperwiki.sql("select (select count(*) from " + escapeSQL(table_name) + ") as total, (select count(*) from " + escapeSQL(table_name) + where + ") as display_total", function (data) {
      var counts = data[0]

      oSettings.jqXHR = $.ajax( {
        "dataType": 'json',
        "type": "GET",
        "url": sqliteEndpoint,
        "data": { q: query },
        "success": function ( response ) {
          // ScraperWiki returns a list of dicts. This converts it to a list of lists.
          var rows = []
          for (var i=0;i<response.length;i++) { 
            var row = []
            for (k in response[i]) {
              row.push(response[i][k])
            }
            rows.push(row)
          }
          // Send the data to dataTables
          fnCallback({ 
            "aaData" : rows,
            "iTotalRecords": data[0].total, // without filtering
            "iTotalDisplayRecords": data[0].display_total // after filtering
          })
        }, 
        "error": function(jqXHR, textStatus, errorThrown) {
          scraperwiki.alert(errorThrown, jqXHR.responseText, "error")
        }
      } );
    }, function(jqXHR, textStatus, errorThrown) {
      scraperwiki.alert(errorThrown, jqXHR.responseText, "error")
    })
  }
}

// Find the column names for a given table
function getTableColumnNames(table_name, callback){
    scraperwiki.sql("select * from " + escapeSQL(table_name) + " limit 1", function(data) {
    callback(_.keys(data[0]))
  }, function(jqXHR, textStatus, errorThrown) {
    scraperwiki.alert(errorThrown, jqXHR.responseText, "error")
  })
}

// Make one of the DataTables (in one tab)
// 'i' should be the integer position of the datatable in the list of all tables
// 'table_name' is obviously the name of the active table
var constructDataTable = function(i, table_name) {
  // Find or make the table
  $(".maintable").hide()
  var id = "table_" + i
  var $outer = $("#" + id)
  if ($outer.length == 0) {
    console.log("making a new table:", table_name)
    $outer = $('<div class="maintable" id="table_' + i + '"> <table class="table table-striped table-bordered innertable display"></table> </div>')
    $('body').append($outer)
  } else {
    $outer.show()
    console.log("reusing cached table:", table_name)
    return
  }
  var $t = $outer.find("table")

  // Find out the column names
  getTableColumnNames(table_name, function(column_names) {
    console.log("Columns", column_names)
    if (column_names.length == 0) {
      scraperwiki.alert("No data in the table", jqXHR.responseText)
      return
    }

    // Make the column headings
        var thead = '<thead><tr>'
    _.each(column_names, function(column_name) {
      thead += '<th>' + column_name + '</th>'
    })
    thead += '</tr></thead>'
    $t.append(thead)

    // Fill in the datatables object
    $t.dataTable({
      "bProcessing": true,
      "bServerSide": true,
      "bDeferRender": true,
      "bPaginate": true,
      "bFilter": true,
      "iDisplayLength": 500,
      "bScrollCollapse": true,
      "sDom": 'pfirt',
      "sPaginationType": "bootstrap",
      "fnServerData": convertData(table_name, column_names),
      "fnRowCallback": function( tr, array, iDisplayIndex, iDisplayIndexFull ) {
          $('td', tr).each(function(){
              $(this).html(
                  $(this).html().replace(
                      /((http|https|ftp):\/\/[a-zA-Z0-9-_~#:\.\?%&\/\[\]@\!\$'\(\)\*\+,;=]+)/g,
                      '<a href="$1" target="_blank">$1</a>'
                  )
              )
          })
          return tr
      }
    })
  })
}

// Create and insert spreadsheet-like tab bar at bottom of page.
// 'tables' should be a list of table names.
// 'active_table' should be the one you want to appear selected.
var constructTabs = function(tables, active_table){
  var $tabs = $('<div>').addClass('tabs-below').appendTo('body')
  var $ul = $('<ul>').addClass('nav nav-tabs').appendTo($tabs)
  $.each(tables, function(i, table_name){
    var li = '<li>'
    if(table_name == active_table){
      var li = '<li class="active">'
    }
    $(li).append('<a href="#">' + table_name + '</a>').bind('click', function(e){
      e.preventDefault()
      $(this).addClass('active').siblings('.active').removeClass('active')
      constructDataTable(i, table_name)
    }).appendTo($ul)
  })
}

// Make all the DataTables and their tabs
var constructDataTables = function() {
  var first_table_name = tables[0]
  constructTabs(tables, first_table_name)
  constructDataTable(0, first_table_name)
}

// Main entry point, make the data table
var settings
var sqliteEndpoint
var tables
$(function(){
  settings = scraperwiki.readSettings()
  sqliteEndpoint = settings.target.url + '/sqlite'

  scraperwiki.sql("select name from " + escapeSQL('sqlite_master') + " where type = 'table'", function(data, textStatus, jqXHR) {
    tables = []
    $.each(data, function (i) {
      tables.push(data[i].name)
    })
    console.log("Tables are:", tables)
    constructDataTables()
  }, function(jqXHR, textStatus, errorThrown) {
    scraperwiki.alert(errorThrown, jqXHR.responseText, "error")
  })

});




