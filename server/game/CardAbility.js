const AbilityLimit = require('./abilitylimit.js');
const AbilityDsl = require('./abilitydsl');
const ThenAbility = require('./ThenAbility');
const Costs = require('./costs.js');
const { Locations, CardTypes, EffectNames, Players } = require('./Constants');

class CardAbility extends ThenAbility {
    constructor(game, card, properties) {
        if(properties.initiateDuel) {
            if(card.type === CardTypes.Character) {
                let prevCondition = properties.condition;
                properties.condition = context => context.source.isParticipating() && (!prevCondition || prevCondition(context));
                properties.target = {
                    cardType: CardTypes.Character,
                    player: context => {
                        if(typeof properties.initiateDuel === 'function') {
                            return properties.initiateDuel(context).opponentChoosesDuelTarget ? Players.Opponent : Players.Self;
                        }
                        return properties.initiateDuel.opponentChoosesDuelTarget ? Players.Opponent : Players.Self;
                    },
                    controller: Players.Opponent,
                    cardCondition: card => card.isParticipating(),
                    gameAction: AbilityDsl.actions.duel(context => {
                        if(typeof properties.initiateDuel === 'function') {
                            return Object.assign({ challenger: context.source }, properties.initiateDuel(context));
                        }
                        return Object.assign({ challenger: context.source }, properties.initiateDuel);
                    })
                };
            } else {
                properties.targets = {
                    challenger: {
                        cardType: CardTypes.Character,
                        controller: Players.Self,
                        cardCondition: card => card.isParticipating()
                    },
                    duelTarget: {
                        dependsOn: 'challenger',
                        cardType: CardTypes.Character,
                        player: context => {
                            if(typeof properties.initiateDuel === 'function') {
                                return properties.initiateDuel(context).opponentChoosesDuelTarget ? Players.Opponent : Players.Self;
                            }
                            return properties.initiateDuel.opponentChoosesDuelTarget ? Players.Opponent : Players.Self;
                        },
                        controller: Players.Opponent,
                        cardCondition: card => card.isParticipating(),
                        gameAction: AbilityDsl.actions.duel(context => {
                            if(typeof properties.initiateDuel === 'function') {
                                return Object.assign({ challenger: context.targets.challenger }, properties.initiateDuel(context));
                            }
                            return Object.assign({ challenger: context.targets.challenger }, properties.initiateDuel);
                        })
                    }
                };
            }
        }
        super(game, card, properties);

        this.title = properties.title;
        this.limit = properties.limit || AbilityLimit.perRound(1);
        this.limit.registerEvents(game);
        this.limit.ability = this;
        this.abilityCost = this.cost;
        this.location = this.buildLocation(card, properties.location);
        this.printedAbility = properties.printedAbility === false ? false : true;
        this.cannotBeCancelled = properties.cannotBeCancelled;
        this.cannotTargetFirst = !!properties.cannotTargetFirst;
        this.cannotBeMirrored = !!properties.cannotBeMirrored;
        this.max = properties.max;
        this.abilityIdentifier = properties.abilityIdentifier;
        this.origin = properties.origin;
        if(!this.abilityIdentifier) {
            this.abilityIdentifier = this.printedAbility ? this.card.id + '1' : '';
        }
        this.maxIdentifier = this.card.name + this.abilityIdentifier;

        if(this.max) {
            this.card.owner.registerAbilityMax(this.maxIdentifier, this.max);
        }

        if(card.getType() === CardTypes.Event && !this.isKeywordAbility()) {
            this.cost = this.cost.concat(Costs.payReduceableFateCost());
        }
    }

    buildLocation(card, location) {
        const DefaultLocationForType = {
            event: Locations.Hand,
            holding: Locations.Provinces,
            province: Locations.Provinces,
            role: Locations.Role,
            stronghold: Locations.StrongholdProvince
        };

        let defaultedLocation = location || DefaultLocationForType[card.getType()] || Locations.PlayArea;

        if(!Array.isArray(defaultedLocation)) {
            defaultedLocation = [defaultedLocation];
        }

        if(defaultedLocation.some(location => location === Locations.Provinces)) {
            defaultedLocation = defaultedLocation.filter(location => location !== Locations.Provinces);
            defaultedLocation = defaultedLocation.concat(this.game.getProvinceArray());
        }

        return defaultedLocation;
    }

    meetsRequirements(context, ignoredRequirements = []) {
        if(this.card.isBlank() && this.printedAbility) {
            return 'blank';
        }

        if(this.isTriggeredAbility() && !this.card.canTriggerAbilities(context, ignoredRequirements) || this.card.type === CardTypes.Event && !this.card.canPlay(context, context.playType)) {
            return 'cannotTrigger';
        }

        if(this.isKeywordAbility() && !this.card.canInitiateKeywords(context)) {
            return 'cannotInitiate';
        }

        if(!ignoredRequirements.includes('limit') && this.limit.isAtMax(context.player)) {
            return 'limit';
        }

        if(!ignoredRequirements.includes('max') && this.max && context.player.isAbilityAtMax(this.maxIdentifier)) {
            return 'max';
        }

        if(this.isCardPlayed() && this.card.isLimited() && context.player.limitedPlayed >= context.player.maxLimited) {
            return 'limited';
        }

        if(!ignoredRequirements.includes('phase') && !this.isKeywordAbility() && this.card.isDynasty && this.card.type === CardTypes.Event && context.game.currentPhase !== 'dynasty') {
            return 'phase';
        }

        return super.meetsRequirements(context, ignoredRequirements);
    }

    getCosts(context, playCosts = true, triggerCosts = true) {
        let costs = super.getCosts(context, playCosts);
        if(!context.subResolution && triggerCosts && context.player.anyEffect(EffectNames.AdditionalTriggerCost)) {
            const additionalTriggerCosts = context.player.getEffects(EffectNames.AdditionalTriggerCost).map(effect => effect(context));
            costs = costs.concat(...additionalTriggerCosts);
        }
        if(!context.subResolution && playCosts && context.player.anyEffect(EffectNames.AdditionalPlayCost)) {
            const additionalPlayCosts = context.player.getEffects(EffectNames.AdditionalPlayCost).map(effect => effect(context));
            return costs.concat(...additionalPlayCosts);
        }
        return costs;
    }

    getReducedCost(context) {
        let fateCost = this.cost.find(cost => cost.getReducedCost);
        return fateCost ? fateCost.getReducedCost(context) : 0;
    }

    isInValidLocation(context) {
        return this.card.type === CardTypes.Event ? context.player.isCardInPlayableLocation(context.source, context.playType) : this.location.includes(this.card.location);
    }

    displayMessage(context, messageVerb = context.source.type === CardTypes.Event ? 'plays' : 'uses') {
        if(this.properties.message) {
            let messageArgs = this.properties.messageArgs;
            if(typeof messageArgs === 'function') {
                messageArgs = messageArgs(context);
            }
            if(!Array.isArray(messageArgs)) {
                messageArgs = [messageArgs];
            }
            this.game.addMessage(this.properties.message, ...messageArgs);
            return;
        }
        let origin = context.ability && context.ability.origin;
        // if origin is the same as source then ignore it
        if(origin === context.source) {
            origin = null;
        }
        // Player1 plays Assassination
        let gainedAbility = origin ? '\'s gained ability from ' : '';
        let messageArgs = [context.player, ' ' + messageVerb + ' ', context.source, gainedAbility, origin];
        let costMessages = this.cost.map(cost => {
            if(cost.getCostMessage) {
                let card = context.costs[cost.getActionName(context)];
                if(card && card.isFacedown && card.isFacedown()) {
                    card = 'a facedown card';
                }
                let [format, args] = ['ERROR - MISSING COST MESSAGE', [' ',' ']];
                [format,args] = cost.getCostMessage(context);
                return { message: this.game.gameChat.formatMessage(format, [card].concat(args)) };
            }
        }).filter(obj => obj);
        if(costMessages.length > 0) {
            // ,
            messageArgs.push(', ');
            // paying 3 honor
            messageArgs.push(costMessages);
        } else {
            messageArgs = messageArgs.concat(['', '']);
        }
        let effectMessage = this.properties.effect;
        let effectArgs = [];
        let extraArgs = null;
        if(!effectMessage) {
            let gameActions = this.getGameActions(context).filter(gameAction => gameAction.hasLegalTarget(context));
            if(gameActions.length > 0) {
                // effects with multiple game actions really need their own effect message
                [effectMessage, extraArgs] = gameActions[0].getEffectMessage(context);
            }
        } else {
            effectArgs.push(context.target || context.ring || context.source);
            extraArgs = this.properties.effectArgs;
        }

        if(extraArgs) {
            if(typeof extraArgs === 'function') {
                extraArgs = extraArgs(context);
            }
            effectArgs = effectArgs.concat(extraArgs);
        }

        if(effectMessage) {
            // to
            messageArgs.push(' to ');
            // discard Stoic Gunso
            messageArgs.push({ message: this.game.gameChat.formatMessage(effectMessage, effectArgs) });
        }
        this.game.addMessage('{0}{1}{2}{3}{4}{5}{6}{7}{8}', ...messageArgs);
    }

    isCardPlayed() {
        return !this.isKeywordAbility() && this.card.getType() === CardTypes.Event;
    }

    isTriggeredAbility() {
        return true;
    }
}

module.exports = CardAbility;
