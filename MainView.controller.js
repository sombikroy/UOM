sap.ui.define([
  "jquery.sap.global",
  "sap/dm/dme/podfoundation/controller/PluginViewController",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (jQuery, PluginViewController, JSONModel, Filter, FilterOperator, MessageToast, MessageBox) {
  "use strict";

  // Empty template for a brand-new UoM
  var EMPTY_NEW_UOM = {
    unitCode:          "",
    dimension:         "",
    isoCode:           "",
    numerator:         null,
    denominator:       null,
    exponentialBase10: null,
    additiveConstant:  null,
    isPrimary:         false,
    isStandard:        false,
    commercialCodes:   []
  };

  return PluginViewController.extend("sr.custom.plugins.manageuom.controller.MainView", {

    // -------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------
    onInit: function () {
      PluginViewController.prototype.onInit.apply(this, arguments);

      // Model that feeds the master table + details tabs
      var oUomsModel = new JSONModel({
        items:       [],
        total:       0,
        selected:    null,
        selectedRaw: ""
      });
      this.getView().setModel(oUomsModel, "uomsModel");

      // Separate model for the create dialog form
      var oNewUomModel = new JSONModel(jQuery.extend(true, {}, EMPTY_NEW_UOM));
      this.getView().setModel(oNewUomModel, "newUomModel");
    },

    onAfterRendering: function () {
      this.getView().byId("backButton").setVisible(this.getConfiguration().backButtonVisible);
      this.getView().byId("closeButton").setVisible(this.getConfiguration().closeButtonVisible);
      this.getView().byId("headerTitle").setText(this.getConfiguration().title);

      var oText = this.getView().byId("textPlugin");
      if (oText && oText.setText) {
        oText.setText(this.getConfiguration().text);
      }

      this.addUoms();
    },

    onExit: function () {
      PluginViewController.prototype.onExit.apply(this, arguments);
    },

    // -------------------------------------------------------------------
    // Data load
    // -------------------------------------------------------------------
    addUoms: function () {
      var sUrl = this.getPublicApiRestDataSourceUri() + "/uom/v1/uoms";
      this.getView().setBusy(true);
      this.executeAjaxGetRequest(
        sUrl,
        {},
        this.handleUomsResponse.bind(this),
        this.handleUomsError.bind(this)
      );
    },

    executeAjaxGetRequest: function (sUrl, oParameters, fnSuccess, fnError) {
      var that = this;
      this.ajaxGetRequest(
        sUrl,
        oParameters,
        function (oResponseData) { (fnSuccess || that.handleResponse).call(that, oResponseData); },
        function (oError, sHttpErrorMessage) { (fnError || that.handleError).call(that, oError, sHttpErrorMessage); }
      );
    },

    handleUomsResponse: function (oResponseData) {
      var oView  = this.getView();
      var oModel = oView.getModel("uomsModel");

      var aItems = Array.isArray(oResponseData) ? oResponseData
               : Array.isArray(oResponseData && oResponseData.value) ? oResponseData.value
               : [];

      aItems.forEach(function (u) {
        u.commercialCodes = Array.isArray(u.commercialCodes) ? u.commercialCodes : [];
      });

      oModel.setProperty("/items", aItems);
      oModel.setProperty("/total", aItems.length);

      if (aItems.length > 0) {
        this._setSelected(aItems[0]);
        var oTable = oView.byId("uomTable");
        if (oTable) {
          oTable.removeSelections();
          var oFirst = oTable.getItems()[0];
          if (oFirst) { oTable.setSelectedItem(oFirst, true); }
        }
      } else {
        this._setSelected(null);
      }

      oView.setBusy(false);
    },

    handleUomsError: function (oError, sHttpErrorMessage) {
      this.getView().setBusy(false);
      this.showErrorMessage(oError || sHttpErrorMessage, true, true);
    },

    handleResponse:  function () {},
    handleError: function (oError, sHttpErrorMessage) {
      this.showErrorMessage(oError || sHttpErrorMessage, true, true);
    },

    // -------------------------------------------------------------------
    // *** CREATE UoM ***
    // -------------------------------------------------------------------

    /** Open the create dialog, pre-reset the form */
    onOpenCreateDialog: function () {
      // Reset model to blank template
      this.getView().getModel("newUomModel").setData(jQuery.extend(true, {}, EMPTY_NEW_UOM));

      // Clear individual input fields (bindings will refresh, but explicit
      // reset guards against stale UI state on some UI5 versions)
      var aInputIds = [
        "newUnitCode", "newDimension", "newIsoCode",
        "newNumerator", "newDenominator", "newExponent", "newAddConst"
      ];
      aInputIds.forEach(function (sId) {
        var oCtrl = this.getView().byId(sId);
        if (oCtrl) {
          oCtrl.setValue("");
          oCtrl.setValueState("None");
        }
      }.bind(this));

      var oPrimary  = this.getView().byId("newIsPrimary");
      var oStandard = this.getView().byId("newIsStandard");
      if (oPrimary)  { oPrimary.setState(false); }
      if (oStandard) { oStandard.setState(false); }

      this._getCreateDialog().open();
    },

    /** Add an empty commercial-code row to the inline table */
    onAddCommCode: function () {
      var oModel = this.getView().getModel("newUomModel");
      var aCodes = oModel.getProperty("/commercialCodes") || [];
      aCodes.push({ commercialCode: "", language: "", shortText: "", longText: "" });
      oModel.setProperty("/commercialCodes", aCodes);
    },

    /** Delete a commercial-code row */
    onDeleteCommCode: function (oEvent) {
      var oModel  = this.getView().getModel("newUomModel");
      var aCodes  = oModel.getProperty("/commercialCodes") || [];
      var oItem   = oEvent.getSource().getParent(); // ColumnListItem
      var oTable  = this.getView().byId("newCommCodesTable");
      var iIndex  = oTable.indexOfItem(oItem);
      if (iIndex >= 0) {
        aCodes.splice(iIndex, 1);
        oModel.setProperty("/commercialCodes", aCodes);
      }
    },

    /** Cancel — just close without saving */
    onCancelCreateUom: function () {
      this._getCreateDialog().close();
    },

    /**
     * Validate + POST the new UoM.
     * Endpoint: POST /uom/v1/uoms
     * Body: standard UoM JSON (same shape as GET response items).
     */
    onSaveNewUom: function () {
      // --- Validation ---
      var oUnitCodeInput = this.getView().byId("newUnitCode");
      var sRaw           = (oUnitCodeInput.getValue() || "").trim();
      // Strip any accidental surrounding double-quotes
      var sUnitCode      = (sRaw.charAt(0) === '"' && sRaw.charAt(sRaw.length - 1) === '"')
                           ? sRaw.slice(1, -1) : sRaw;

      if (!sUnitCode) {
        oUnitCodeInput.setValueState("Error");
        oUnitCodeInput.setValueStateText("Unit Code is required.");
        MessageToast.show("Please enter a Unit Code.");
        return;
      }
      oUnitCodeInput.setValueState("None");

      // --- Build payload ---
      // Rules per API contract:
      //   - unitCode, dimension, isoCode, commercialCode sub-fields → plain string (no extra quotes)
      //   - numerator, denominator, exponentialBase10, additiveConstant → real JS number (integer)
      //   - isPrimary, isStandard → real JS boolean (true/false, NOT "0"/"1")
      //   - commercialCodes → array (empty [] when none)
      var oModel = this.getView().getModel("newUomModel");

      // Read a raw input value, strip surrounding quotes UI5 may inject, trim whitespace
      var fnStr = function (sId) {
        var s = (this.getView().byId(sId).getValue() || "").trim();
        // Strip any accidental surrounding double-quotes
        if (s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
          s = s.slice(1, -1);
        }
        return s;
      }.bind(this);

      // Parse to integer; default to 0 if blank or NaN
      var fnInt = function (sId) {
        var s = (this.getView().byId(sId).getValue() || "").trim();
        var n = parseInt(s, 10);
        return isNaN(n) ? 0 : n;
      }.bind(this);

      // Sanitise a plain string value from the model (commercial code sub-fields)
      var fnClean = function (v) {
        var s = (v || "").trim();
        if (s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
          s = s.slice(1, -1);
        }
        return s;
      };

      var aCommercialCodes = (oModel.getProperty("/commercialCodes") || [])
        .filter(function (c) { return c.commercialCode && c.commercialCode.trim(); })
        .map(function (c) {
          return {
            commercialCode: fnClean(c.commercialCode),
            language:       fnClean(c.language),
            shortText:      fnClean(c.shortText),
            longText:       fnClean(c.longText)
          };
        });

      // getState() on a sap.m.Switch always returns a real boolean — safe to use directly
      var oPayload = {
        unitCode:          sUnitCode,
        dimension:         fnStr("newDimension"),
        isoCode:           fnStr("newIsoCode"),
        numerator:         fnInt("newNumerator"),
        denominator:       fnInt("newDenominator"),
        exponentialBase10: fnInt("newExponent"),
        additiveConstant:  fnInt("newAddConst"),
        isPrimary:         Boolean(this.getView().byId("newIsPrimary").getState()),
        isStandard:        Boolean(this.getView().byId("newIsStandard").getState()),
        commercialCodes:   aCommercialCodes
      };

      // --- POST ---
      var sUrl    = this.getPublicApiRestDataSourceUri() + "/uom/v1/uoms";
      var oSaveBtn = this.getView().byId("createSaveBtn");
      oSaveBtn.setEnabled(false);
      this.getView().setBusy(true);

      // API expects an array: [{...}]
      this.ajaxPostRequest(
        sUrl,
        [oPayload],
        function (oResponse) {
          this.getView().setBusy(false);
          oSaveBtn.setEnabled(true);
          this._getCreateDialog().close();
          MessageToast.show("Unit of Measure '" + sUnitCode + "' created successfully.");
          // Reload list so the new item appears
          this.addUoms();
        }.bind(this),
        function (oError, sHttpErrorMessage) {
          this.getView().setBusy(false);
          oSaveBtn.setEnabled(true);

          // Parse the error response body if available
          var sMsg;
          try {
            var oErrBody = (typeof oError === "string") ? JSON.parse(oError) : oError;
            if (oErrBody && oErrBody.status === 409) {
              sMsg = oErrBody.displayMessage || "Unit of Measure already exists.";
            } else if (oErrBody && oErrBody.displayMessage) {
              sMsg = oErrBody.displayMessage;
            } else {
              sMsg = (oErrBody && oErrBody.message) ? oErrBody.message : (sHttpErrorMessage || "An unexpected error occurred.");
            }
          } catch (e) {
            sMsg = sHttpErrorMessage || "An unexpected error occurred.";
          }

          MessageBox.error(sMsg, { title: "Create UoM Failed" });
        }.bind(this)
      );
    },

    /** Lazy-load the dialog (defined inline in the view) */
    _getCreateDialog: function () {
      return this.getView().byId("createUomDialog");
    },

    // -------------------------------------------------------------------
    // Selection & helpers
    // -------------------------------------------------------------------
    onUomSelect: function (oEvent) {
      var oCtx = oEvent.getParameter("listItem").getBindingContext("uomsModel");
      this._setSelected(oCtx ? oCtx.getObject() : null);
    },

    onUomPress: function (oEvent) {
      var oCtx = oEvent.getSource().getBindingContext("uomsModel");
      this._setSelected(oCtx ? oCtx.getObject() : null);
    },

    _setSelected: function (oUom) {
      var oModel = this.getView().getModel("uomsModel");
      oModel.setProperty("/selected",    oUom);
      oModel.setProperty("/selectedRaw", oUom ? JSON.stringify(oUom, null, 2) : "");
    },

    // -------------------------------------------------------------------
    // Search (client-side)
    // -------------------------------------------------------------------
    onSearch: function (oEvent) {
      // liveChange fires "newValue"; search event fires "query" — handle both
      var sQuery = (oEvent.getParameter("newValue") || oEvent.getParameter("query") || oEvent.getSource().getValue() || "").trim();
      var oTable = this.getView().byId("uomTable");
      if (!oTable) { return; }

      var oBinding = oTable.getBinding("items");
      if (!sQuery) { oBinding.filter([]); return; }

      // Use standard UI5 Filter with Contains operator — reliable with JSONModel
      // OR-combine filters across all searchable string fields
      var aFilters = [
        new Filter("unitCode",  FilterOperator.Contains, sQuery),
        new Filter("dimension", FilterOperator.Contains, sQuery),
        new Filter("isoCode",   FilterOperator.Contains, sQuery)
      ];

      // Wrap in an OR filter so any matching field returns the row
      oBinding.filter(new Filter({ filters: aFilters, and: false }));
    },

    // -------------------------------------------------------------------
    // Refresh
    // -------------------------------------------------------------------
    onRefresh: function () { this.addUoms(); },

    // -------------------------------------------------------------------
    // POD notification hooks
    // -------------------------------------------------------------------
    onBeforeRenderingPlugin:      function () {},
    isSubscribingToNotifications: function () { return true; },
    getCustomNotificationEvents:  function () {},
    getNotificationMessageHandler: function () { return null; }
  });
});
