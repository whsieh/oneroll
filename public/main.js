
var scheduledCacheUpdateId = -1;

function randint(min, max) {
    var range = max - min;
    return min + Math.floor(Math.random() * (range + 1));
}

function computeRollResults(rollString) {
    rollString = rollString.replace(/\s/g, "").replace(/\-/g, "+-").replace(/\+\+/g, "+").toLowerCase();
    var rollResults = [];
    if (rollString.startsWith("+"))
        rollString = rollString.substr(1);

    if (rollString.indexOf("+") == -1) {
        // Handle the single case here.
        var negateValue = false;
        if (rollString.startsWith("-")) {
            rollString = rollString.substr(1);
            negateValue = true;
        }
        var dIndex = rollString.indexOf("d");
        if (dIndex == -1) {
            var value = parseInt(rollString);
            return isNaN(value) ? null : [[0, negateValue ? -value : value]];
        }
        var numRolls = parseInt(rollString.substr(0, dIndex));
        var numSides = parseInt(rollString.substr(dIndex + 1));
        if (isNaN(numSides) || isNaN(numSides))
            return null;

        for (var i = 0; i < numRolls; i++) {
            var roll = randint(1, numSides);
            rollResults.push([parseInt(numSides), negateValue ? -roll : roll]);
        }
        return rollResults;
    }
    var separatedDetails = rollString.split("+");
    for (var i = 0; i < separatedDetails.length; i++) {
        var singleRollString = separatedDetails[i];
        if (singleRollString.length == 0)
            continue;

        var singleRollResult = computeRollResults(singleRollString);
        if (!singleRollResult)
            return null;

        rollResults = rollResults.concat(singleRollResult);
    }
    return rollResults;
}

function registerElementForFastClick(element) {
    (function() {
        var touchMoveCount = 0;
        $(element).bind("touchstart", function(e) {
            touchMoveCount = 0;
        });

        $(element).bind("touchmove", function(e) {
            touchMoveCount++;
        });

        $(element).bind("touchend", function(e) {
            var targetElement = e.target;
            if (touchMoveCount < 3) {
                if (targetElement.tagName == "INPUT" && targetElement.type == "text")
                    targetElement.focus();
                else
                    targetElement.click();

                e.preventDefault();
            }
            touchMoveCount = 0;
        });
    })();
}

/**
 * The messaging controller is in charge of managing interaction between the client
 * and the server when broadcasting and receiving the results of rolls from other users.
 */

function MessagingController(name, port, transcriptController) {
    this.socket = null;
    this.name = name;
    this.port = port;
    this.transcriptController = transcriptController;
}

MessagingController.prototype.isReady = function() {
    return !!this.socket;
}

MessagingController.prototype.handshake = function() {
    var $this = this;
    var socket = io.connect(window.location.protocol + "//" + window.location.hostname + ":" + this.port);
    socket.on("server_request_name", function() {
        socket.emit("client_name_response", $this.name);
    });

    socket.on("server_handshaking_complete", function(name) {
        if ($this.name === name)
            $this.socket = socket;

        $this.transcriptController.appendNewParticipant(name, $this.name);
    });

    socket.on("server_notify_roll", function(objectString) {
        var parsedObject = JSON.parse(objectString);
        $this.transcriptController.appendRollResult(parsedObject.result, parsedObject.rollName, parsedObject.userName);
    });
}

MessagingController.prototype.broadcastRollResult = function(result, rollName) {
    if (!this.isReady())
        return;

    rollName = !!rollName ? rollName : "";
    this.socket.emit("client_broadcasted_roll", JSON.stringify({
        "result": result,
        "rollName": rollName,
        "userName": this.name
    }));
}

/**
 * The transcript controller is in charge of managing the contents of the
 * transcript, which contains roll history.
 */

function TranscriptController(rollHistoryElementId) {
    this.transcriptElement = $(rollHistoryElementId)[0];
    this.showDetails = false;
    this.showOwnHistoryOnly = false;
}

TranscriptController.prototype.updateHistoryVisibility = function() {
    if (this.showDetails)
        $(".history-detail").css({ display: "block" });
    else
        $(".history-detail").css({ display: "none" });

    if (this.showOwnHistoryOnly) {
        $(".not-own-history").css({ display: "none" });
        $(".participant-joined").css({ display: "none" });
    } else {
        $(".not-own-history").css({ display: "block" });
        $(".participant-joined").css({ display: "block" });
    }
}

TranscriptController.prototype.toggleShowDetails = function() {
    if (this.showDetails) {
        $("#detailed-history-button").removeClass("toggle-active");
        $("#detailed-history-button").addClass("toggle-inactive");
    } else {
        $("#detailed-history-button").removeClass("toggle-inactive");
        $("#detailed-history-button").addClass("toggle-active");
    }
    this.showDetails = !this.showDetails;
    this.updateHistoryVisibility();
}

TranscriptController.prototype.toggleShowOwnHistoryOnly = function() {
    if (this.showOwnHistoryOnly) {
        $("#own-history-button").removeClass("toggle-active");
        $("#own-history-button").addClass("toggle-inactive");
    } else {
        $("#own-history-button").removeClass("toggle-inactive");
        $("#own-history-button").addClass("toggle-active");
    }
    this.showOwnHistoryOnly = !this.showOwnHistoryOnly;
    this.updateHistoryVisibility();
}

TranscriptController.prototype.appendNewParticipant = function(participantName, myName) {
    var participantMessage;
    if (myName === participantName)
        participantMessage = "You joined the room as " + myName + ".";
    else
        participantMessage = participantName + " joined the room.";

    var participantMessageElement = $("<p>", { class: "participant-joined history-main" });
    participantMessageElement.text(participantMessage);
    participantMessageElement.prependTo(this.transcriptElement);
    this.updateHistoryVisibility();
    this.transcriptElement.scrollTop = 0;

    participantMessageElement.css({ opacity: 0 });
    participantMessageElement.animate({ opacity: 1 }, 350);
}

TranscriptController.prototype.appendRollResult = function(parts, name, userName) {
    // Each part indicates the roll result for a single die. Parts is a list of
    // tuples [s, r] where s is the number of sides and r is the die roll. s=0
    // indicates that r is a constant modifier.
    // If name is undefined or null, this is roll is assumed to be a single die
    // roll.
    // HACK: This is terrible.
    var isFromMe = userName == undefined;
    if (isFromMe)
        userName = "You";

    var total = 0;
    var submessages = [];
    var totalModifier = 0;
    for (var i = 0; i < parts.length; i++) {
        var numSides = parts[i][0];
        var result = parts[i][1];
        if (numSides > 0)
            submessages.push(userName + " rolled a D" + numSides + " for " + result + ".");
        else
            totalModifier += result;
        total += result;
    }
    if (totalModifier != 0)
        submessages.push("The net roll modifier is " + totalModifier + ".");
    
    var mainMessage;
    if (name)
        mainMessage = userName + " rolled '" + name + "' for a total of " + total + ".";
    else
        mainMessage = userName + " rolled a single D" + parts[0][0] + " for " + total + ".";

    if (submessages.length > 1) {
        for (var i = 0; i < submessages.length; i++) {
            var detailElement;
            if (isFromMe)
                detailElement = $("<p>", { class: "history-detail" });
            else
                detailElement = $("<p>", { class: "history-detail not-own-history" });
            detailElement.text(submessages[i]);
            detailElement.css({ opacity: 0 });
            detailElement.prependTo(this.transcriptElement);
            detailElement.animate({ opacity: 1 }, 350);
        }
    }
    var mainMessageElement;
    if (isFromMe)
        mainMessageElement = $("<p>", { class: "history-main" });
    else
        mainMessageElement = $("<p>", { class: "history-main not-own-history" });

    mainMessageElement.text(mainMessage);
    mainMessageElement.prependTo(this.transcriptElement);
    this.updateHistoryVisibility();
    this.transcriptElement.scrollTop = 0;

    mainMessageElement.css({ opacity: 0 });
    mainMessageElement.animate({ opacity: 1 }, 350);
}

TranscriptController.prototype.clearHistory = function() {
    var children = this.transcriptElement.children;
    while (children.length > 0)
        children[0].remove();
}

/**
 * Manages the different types of rolls. Also performs the rolls and delegates
 * logic to the above controllers when necessary.
 */

function RollController(pickerElementId, transcriptController, messagingController) {
    this.pickerElement = $(pickerElementId)[0];
    this.transcriptController = transcriptController;
    this.messagingController = messagingController;
}

RollController.prototype.appendCard = function(name, details) {
    name = name != undefined ? name : "";
    details = details != undefined ? details : "";
    // Create the inputs that will appear in the card.
    var nameField = $("<input>", {
        type: "text",
        placeholder: "Roll name",
        class: "roll-card-title",
        value: name
    });

    var detailsField = $("<input>", {
        type: "text",
        placeholder: "Roll details",
        class: "roll-card-details",
        value: details
    });

    var rollButton = $("<input>", {
        type: "button",
        class: "roll-card-roll",
        value: "Roll"
    });

    var deleteButton = $("<input>", {
        type: "button",
        class: "roll-card-delete",
        value: "Delete"
    });

    // Then construct left and right halves of the card.
    var leftPart = $("<div>", {
        class: "left"
    });
    nameField.appendTo(leftPart);
    detailsField.appendTo(leftPart);

    var rightPart = $("<div>", {
        class: "right"
    });
    rollButton.appendTo(rightPart);
    deleteButton.appendTo(rightPart);

    // Construct the top-level card and append it to the picker.
    var card = $("<div>", {
        class: "roll-card"
    });
    leftPart.appendTo(card);
    rightPart.appendTo(card);
    card.insertBefore($("#add-card"));

    var $this = this;
    // Finally, bind event handlers where necessary.
    $(rollButton).click(function() {
        var rollResult = computeRollResults(detailsField.val());
        if (!rollResult)
            return;

        var rollName = nameField.val();
        $this.transcriptController.appendRollResult(rollResult, rollName);
        $this.messagingController.broadcastRollResult(rollResult, rollName);
    });

    $(deleteButton).click(function() {
        card.remove();
        $this.regenerateLocalCache();
    });

    var scheduleLocalCacheRegeneration = function() {
        if (scheduledCacheUpdateId != -1) {
            // If an update was scheduled already, reschedule and restart the timer.
            clearTimeout(scheduledCacheUpdateId);
        }
        scheduledCacheUpdateId = setTimeout(function() {
            $this.regenerateLocalCache();
            scheduledCacheUpdateId = -1;
        }, 10000);
    }

    $(nameField).bind("input", scheduleLocalCacheRegeneration);
    $(detailsField).bind("input", scheduleLocalCacheRegeneration);

    registerElementForFastClick(rollButton);
    registerElementForFastClick(deleteButton);
    registerElementForFastClick(nameField);
    registerElementForFastClick(detailsField);
}

RollController.prototype.currentRolls = function() {
    var rollCards = $(".roll-card");
    var result = [];
    for (var i = 0; i < rollCards.length; i++) {
        var card = rollCards[i];
        var name = card.querySelector(".roll-card-title");
        var details = card.querySelector(".roll-card-details");
        result.push({ "name": name.value, "details": details.value });
    }
    return result;
}

RollController.prototype.regenerateLocalCache = function() {
    Cookies.remove("rolls");
    Cookies.set("rolls", this.currentRolls());
}

RollController.prototype.loadFromLocalCache = function() {
    var savedRolls = Cookies.getJSON("rolls");
    if (!savedRolls)
        return;

    for (var i = 0; i < savedRolls.length; i++) {
        var savedRoll = savedRolls[i];
        this.appendCard(savedRoll.name, savedRoll.details);
    }
}

$(function() {
    var name = /name=(.*)&/.exec(location.search)[1];
    var port = /port=([0-9]+)/.exec(location.search)[1];
    // Initialize shared controllers.
    var transcriptController = new TranscriptController("#roll-transcript");
    var messagingController = new MessagingController(name, port, transcriptController);
    var rollController = new RollController("#roll-picker", transcriptController, messagingController);

    // Bind all static element handlers.
    $("#new-roll-link").click(function() {
        rollController.appendCard();
    });

    $("#detailed-history-button").click(function() {
        transcriptController.toggleShowDetails();
    });

    $("#own-history-button").click(function() {
        transcriptController.toggleShowOwnHistoryOnly();
    });

    $("#clear-history-button").click(function() {
        transcriptController.clearHistory();
    });

    $(".die").click(function(e) {
        var rollResult = computeRollResults(e.target.id);
        if (!rollResult)
            return;

        transcriptController.appendRollResult(rollResult);
        messagingController.broadcastRollResult(rollResult);
    });

    var controls = $("input, .die, a");
    for (var i = 0; i < controls.length; i++)
        registerElementForFastClick(controls[i]);

    // Load locally cached information.
    rollController.loadFromLocalCache();

    // Connect to the server and handshake.
    messagingController.handshake();
});
