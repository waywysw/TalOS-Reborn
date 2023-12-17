/* eslint-disable @typescript-eslint/no-explicit-any */
import llamaTokenizer from './helpers/llama-tokenizer-modified.js';
import { CharacterInterface, fetchCharacterById } from './characters.js';
import { CompletionRequest, GenericCompletionConnectionTemplate, InstructMode, Message, SettingsInterface, SettingsInterfaceToMancerSettings, UserPersona, fetchConnectionById } from './connections.js';
import { fetchAllAppSettings, fetchSettingById } from './settings.js';
import express from 'express';
import { authenticateToken } from './authenticate-token.js';

export const llmsRouter = express.Router();

function getTokens(text: string){
    //@ts-expect-error fuck off
    return llamaTokenizer.encode(text).length;
}

function getInstructTokens(message: Message, instructFormat: InstructMode){
    switch(instructFormat){
        case "Alpaca":
            if(message.role === "System"){
                return getTokens(`### Instruction:\n${message.swipes[message.currentIndex]}`);
            }else if(message.thought === true){
                return getTokens(`### Response:\n${message.fallbackName}'s Thoughts: ${message.swipes[message.currentIndex]}`);
            }else if(message.role === "User"){
                return getTokens(`### Instruction:\n${message.fallbackName}: ${message.swipes[message.currentIndex]}`);
            }else if(message.role === "Assistant"){
                return getTokens(`### Response:\n${message.fallbackName}: ${message.swipes[message.currentIndex]}`);
            }
            return getTokens(`### Instruction:\n${message.swipes[message.currentIndex]}`);
        case "Vicuna":
            if(message.role === "System"){
                return getTokens(`SYSTEM: ${message.swipes[message.currentIndex]}`);
            }
            else if(message.thought === true){
                return getTokens(`ASSISTANT: ${message.fallbackName}'s Thoughts: ${message.swipes[message.currentIndex]}`);
            }
            else if(message.role === "User"){
                return getTokens(`USER: ${message.fallbackName}: ${message.swipes[message.currentIndex]}`);
            }
            else if(message.role === "Assistant"){
                return getTokens(`ASSISTANT: ${message.fallbackName}: ${message.swipes[message.currentIndex]}`);
            }
            return getTokens(`SYSTEM: ${message.swipes[message.currentIndex]}`);
        case "Metharme":
            if(message.role === "System"){
                return getTokens(`<|user|>${message.swipes[message.currentIndex]}`);
            }
            else if(message.thought === true){
                return getTokens(`<|model|>${message.fallbackName}'s Thoughts: ${message.swipes[message.currentIndex]}`);
            }
            else if(message.role === "User"){
                return getTokens(`<|user|>${message.fallbackName}: ${message.swipes[message.currentIndex]}`);
            }
            else if(message.role === "Assistant"){
                return getTokens(`<|model|>${message.fallbackName}: ${message.swipes[message.currentIndex]}`);
            }
            return getTokens(`<|user|>${message.swipes[message.currentIndex]}`);
        default:
            if(message.role === "System"){
                return getTokens(message.swipes[message.currentIndex]);
            }
            else if(message.thought === true){
                return getTokens(`${message.fallbackName}'s Thoughts: ${message.swipes[message.currentIndex]}`);
            }
            else if(message.role === "User"){
                return getTokens(`${message.fallbackName}: ${message.swipes[message.currentIndex]}`);
            }
            else if(message.role === "Assistant"){
                return getTokens(`${message.fallbackName}: ${message.swipes[message.currentIndex]}`);
            }
            return getTokens(message.swipes[message.currentIndex]);
    }
}

function fillChatContextToLimit(chatLog: Message[], tokenLimit: number, instructFormat: InstructMode = "None"){
    const messagesToInclude: Message[] = [];
    let tokenCount = 0;
    for(let i = chatLog.length - 1; i >= 0; i--){
        const message = chatLog[i];
        const tokens: number = getInstructTokens(message, instructFormat);
        if(tokens + tokenCount <= tokenLimit){
            messagesToInclude.unshift(message);
            tokenCount += tokens;
        } else {
            break;
        }
    }
    return messagesToInclude;
}

function assemblePromptFromLog(messages: Message[], contextLength: number = 4048, constructName: string = "Bot", system_prompt: string = "", persona?: UserPersona | null){
	let prompt = "";
	const newMessages = fillChatContextToLimit(messages, contextLength, "None");
	for(let i = 0; i < newMessages.length; i++){
        const messageText = messages[i].swipes[messages[i].currentIndex].trim();
		if(newMessages[i].role === 'System'){
			prompt += `${messageText}\n`;
			continue;
		}else{
			if(newMessages[i].thought === true){
                prompt += `${newMessages[i].fallbackName}'s Thoughts: ${messageText}\n`;
            }else{
                prompt += `${newMessages[i].fallbackName}: ${messageText}\n`;
            }
		}
	}
    // insert system prompt at the 4th line from the end
    if(newMessages.length > 0){
        const lines = prompt.split("\n");
        if(system_prompt.trim() !== ""){
            lines.splice(lines.length - 3, 0, system_prompt);
        }
        if(persona){
            if((persona?.description) && (persona?.description.trim() !== "") && (persona?.importance === 'high')){
                lines.splice(lines.length - 4, 0,`[${persona.description.trim()}]`);
            }
        }
        prompt = lines.join("\n");
    }
    // If the last message was not from the bot, we append an empty response for the bot
    if (newMessages.length > 0 && newMessages[newMessages.length - 1].role !== "Assistant") {
        prompt += `${constructName}:`;
    }
	return prompt;
}

function assembleAlpacaPromptFromLog(messages: Message[], contextLength: number = 4048, constructName: string = "Bot", system_prompt: string = "", persona?: UserPersona | null){
    let prompt = "";
    const newMessages = fillChatContextToLimit(messages, contextLength, "Alpaca");
    for(let i = 0; i < newMessages.length; i++){
        const messageText = newMessages[i].swipes[newMessages[i].currentIndex].trim();

        if(newMessages[i].role === 'System'){
            prompt += `### Instruction:\n${messageText}\n`;
            continue;
        } else if (newMessages[i].thought === true) {
			prompt += `### Response:\n${newMessages[i].fallbackName}'s Thoughts: ${messageText}\n`;
        } else {
            if (newMessages[i].role === 'User') {
                prompt += `### Instruction:\n${newMessages[i].fallbackName}: ${messageText}\n`;
            } else {
                prompt += `### Response:\n${newMessages[i].fallbackName}: ${messageText}\n`;
            }
        }
        // ?? idk if im doing this right, feel kinda dumb, TODO: fix this
        if(i === newMessages.length - 3 && system_prompt !== ""){
            prompt += `${system_prompt}\n`;
        }
        if(i === newMessages.length - 3 && persona){
            if((persona?.description) && (persona?.description.trim() !== "") && (persona?.importance === 'high')){
                prompt += `[${persona.description.trim()}]`;
            }
        }
    }
    // If the last message was not from the bot, we append an empty response for the bot
    if (newMessages.length > 0 && newMessages[newMessages.length - 1].role !== "Assistant") {
        prompt += `### Response:\n${constructName}:`;
    }

    return prompt;
}

function assembleVicunaPromptFromLog(messages: Message[], contextLength: number = 4048, constructName: string = "Bot", system_prompt: string = "", persona?: UserPersona | null){
    let prompt = "";
    const newMessages = fillChatContextToLimit(messages, contextLength, "Vicuna");
    for(let i = 0; i < newMessages.length; i++){
        const messageText = newMessages[i].swipes[newMessages[i].currentIndex].trim();

        if(newMessages[i].role === 'System'){
            prompt += `SYSTEM: ${messageText}\n`;
            continue;
        } else if (newMessages[i].thought === true) {
			prompt += `ASSISTANT: ${newMessages[i].fallbackName}'s Thoughts: ${messageText}\n`;
        } else {
            if (newMessages[i].role === 'User') {
                prompt += `USER: ${newMessages[i].fallbackName}: ${messageText}\n`;
            } else {
                prompt += `ASSISTANT: ${newMessages[i].fallbackName}: ${messageText}\n`;
            }
        }
    }
    // insert system prompt at the 4th line from the end
    if(newMessages.length > 0){
        const lines = prompt.split("\n");
        if(system_prompt.trim() !== ""){
            lines.splice(lines.length - 3, 0, system_prompt);
        }
        if(persona){
            if((persona?.description) && (persona?.description.trim() !== "") && (persona?.importance === 'high')){
                lines.splice(lines.length - 4, 0,`[${persona.description.trim()}]`);
            }
        }
        prompt = lines.join("\n");
    }
    // If the last message was not from the bot, we append an empty response for the bot
    if (newMessages.length > 0 && newMessages[newMessages.length - 1].role !== "Assistant") {
        prompt += `ASSISTANT: ${constructName}:`;
    }

    return prompt;
}

function assembleMetharmePromptFromLog(messages: Message[], contextLength: number = 4048, constructName: string = "Bot", system_prompt: string = "", persona?: UserPersona | null){
    let prompt = "";
    const newMessages = fillChatContextToLimit(messages, contextLength, "Metharme");
    for(let i = 0; i < newMessages.length; i++){
        const messageText = newMessages[i].swipes[newMessages[i].currentIndex].trim();

        if(newMessages[i].role === 'System'){
            prompt += `<|system|>${messageText}`;
            continue;
        } else if (newMessages[i].thought === true) {
			prompt += `<|model|>${newMessages[i].fallbackName}'s Thoughts: ${messageText}`;
        } else {
            if (newMessages[i].role === 'User') {
                prompt += `<|user|>${newMessages[i].fallbackName}: ${messageText}`;
            } else {
                prompt += `<|model|>${newMessages[i].fallbackName}: ${messageText}`;
            }
        }
        // ?? idk if im doing this right, feel kinda dumb, TODO: fix this
        if(i === newMessages.length - 3 && system_prompt !== ""){
            prompt += `<|system|>${system_prompt}`;
        }
        if(i === newMessages.length - 3 && persona){
            if((persona?.description) && (persona?.description.trim() !== "") && (persona?.importance === 'high')){
                prompt += `<|system|>[${persona.description.trim()}]`;
            }
        }
    }
    // If the last message was not from the bot, we append an empty response for the bot
    if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'User') {
        prompt += `<|model|>${constructName}:`;
    }
    return prompt;
}

export function getCharacterPromptFromConstruct(character: CharacterInterface) {
    let prompt = '';
    if(character.description.trim().length > 0){
        prompt = character.description;
    }
    if(character.personality.trim().length > 0){
        prompt += character.personality;
    }
    if(character.mes_example.trim().length > 0){
        prompt += character.mes_example;
    }
    if(character.scenario.trim().length > 0){
        prompt += character.scenario;
    }
    return prompt;
}

async function formatCompletionRequest(request: CompletionRequest){
    let character: CharacterInterface;
    if(typeof request.character === "string"){
        character = await fetchCharacterById(request.character) as CharacterInterface;
    }
    else{
        character = request.character;
    }
    let characterPrompt = "";
    if(character){
        characterPrompt = getCharacterPromptFromConstruct(character);
    }
    let prompt = characterPrompt;
    const characterPromptTokens = getTokens(characterPrompt);
    const appSettings = fetchAllAppSettings();
    console.log(appSettings);
    let connectionid = request.connectionid;
    if(!connectionid){
        connectionid = appSettings?.defaultConnection ?? "";
    }
    if(!connectionid){
        return null;
    }
    const modelInfo = fetchConnectionById(connectionid) as GenericCompletionConnectionTemplate;
    if(!modelInfo){
        return null;
    }
    let settingsid = request.settingsid;
    if(!settingsid){
        settingsid = appSettings?.defaultSettings ?? "";
    }
    if(!settingsid){
        return null;
    }
    const settingsInfo = fetchSettingById(settingsid) as SettingsInterface;
    if(!settingsInfo){
        return null;
    }
    if((request?.persona) && (request?.persona?.description) && (request?.persona?.description.trim() !== "") && (request?.persona?.importance === 'low')){
        prompt += `[${request.persona.description.trim()}]`;
    }
    const leftoverTokens = settingsInfo.context_length - characterPromptTokens;
    if(settingsInfo.instruct_mode === "Alpaca"){
        prompt += assembleAlpacaPromptFromLog(request.messages, leftoverTokens , character ? character.name : "Bot", character ? character.system_prompt : "", request?.persona);
    }
    else if(settingsInfo.instruct_mode === "Vicuna"){
        prompt += assembleVicunaPromptFromLog(request.messages, leftoverTokens, character ? character.name : "Bot", character ? character.system_prompt : "", request?.persona);
    }
    else if(settingsInfo.instruct_mode === "Metharme"){
        prompt += assembleMetharmePromptFromLog(request.messages, leftoverTokens, character ? character.name : "Bot", character ? character.system_prompt : "", request?.persona);
    }
    else{
        prompt += assemblePromptFromLog(request.messages, leftoverTokens, character ? character.name : "Bot", character ? character.system_prompt : "", request?.persona);
    }
    return prompt.replace(new RegExp('{{user}}', 'g'), `${request?.persona?.name ?? 'You'}`).replace(new RegExp('{{char}}', 'g'), `${character.name}`);
}

function getStopSequences(messages: Message[]){
    const stopSequences: string[] = [];
    for(let i = 0; i < messages.length; i++){
        const message = messages[i];
        if(stopSequences.includes(message.fallbackName)){
            continue;
        }
        stopSequences.push(`${message.fallbackName}:`);
    }
    return stopSequences;
}

async function getMancerCompletion(request: CompletionRequest){
    const prompt = await formatCompletionRequest(request);
    const stopSequences = getStopSequences(request.messages);
    const appSettings = fetchAllAppSettings();
    console.log(appSettings);
    let connectionid = request.connectionid;
    if(!connectionid){
        connectionid = appSettings?.defaultConnection ?? "";
    }
    if(!connectionid){
        return null;
    }
    const modelInfo = fetchConnectionById(connectionid) as GenericCompletionConnectionTemplate;
    if(!modelInfo){
        return null;
    }
    let settingsid = request.settingsid;
    if(!settingsid){
        settingsid = appSettings?.defaultSettings ?? "";
    }
    if(!settingsid){
        return null;
    }
    const settingsInfo = fetchSettingById(settingsid) as SettingsInterface;
    if(!settingsInfo){
        return null;
    }
    if(modelInfo.model === "weaver-alpha" || modelInfo.model === "mythomax"){
        stopSequences.push("###");
    }
    if(modelInfo.model === "synthia-70b" || modelInfo.model === "goliath-120b"){
        stopSequences.push("USER:");
        stopSequences.push("ASSISTANT:");
    }
    if(modelInfo.model === "mythalion"){
        stopSequences.push("<|user|>");
        stopSequences.push("<|model|>");
    }
    const settingsProper = SettingsInterfaceToMancerSettings(settingsInfo);
    const body = {
        'model': modelInfo.model,
        'prompt': prompt,
        'stop': stopSequences,
        ...settingsProper,
    }
    console.log(body);
    try {
        const response = await fetch(`https://neuro.mancer.tech/oai/v1/completions`, {
            method: 'POST',
            body: JSON.stringify(body),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${modelInfo.key?.trim()}`,
            },
        });
        const json = await response.json();
        return json;
    } catch (error) {
        console.error('Error in getMancerCompletion:', error);
        return null;
    }
}

llmsRouter.post('/completions/mancer', authenticateToken, async (req, res) => {
    const request = req.body as CompletionRequest;
    const response = await getMancerCompletion(request);
    res.send(response);
});

async function getGenericCompletion(request: CompletionRequest){
    const prompt = await formatCompletionRequest(request);
    const stopSequences = getStopSequences(request.messages);
    const appSettings = fetchAllAppSettings();
    console.log(appSettings);
    let connectionid = request.connectionid;
    if(!connectionid){
        connectionid = appSettings?.defaultConnection ?? "";
    }
    if(!connectionid){
        return null;
    }
    const modelInfo = fetchConnectionById(connectionid) as GenericCompletionConnectionTemplate;
    if(!modelInfo){
        return null;
    }
    let settingsid = request.settingsid;
    if(!settingsid){
        settingsid = appSettings?.defaultSettings ?? "";
    }
    if(!settingsid){
        return null;
    }
    const settingsInfo = fetchSettingById(settingsid) as SettingsInterface;
    if(!settingsInfo){
        return null;
    }
    if(modelInfo.model === "weaver-alpha" || modelInfo.model === "mythomax"){
        stopSequences.push("###");
    }
    if(modelInfo.model === "synthia-70b" || modelInfo.model === "goliath-120b"){
        stopSequences.push("USER:");
        stopSequences.push("ASSISTANT:");
    }
    if(modelInfo.model === "mythalion"){
        stopSequences.push("<|user|>");
        stopSequences.push("<|model|>");
    }
    const body = {
        'model': modelInfo.model,
        'prompt': prompt,
        'stop': stopSequences,
        ...settingsInfo
    }
    console.log(body);
    try {
        const newURL = new URL(modelInfo.url as string);
        const response = await fetch(`${newURL.protocol}//${newURL.hostname}${newURL.port? `:${newURL.port}` : ''}` + '/v1/completions', {
            method: 'POST',
            body: JSON.stringify(body),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${modelInfo.key?.trim()}`,
            },
        });
        const json = await response.json();
        return json;
    } catch (error) {
        console.error('Error in getGenericCompletion:', error);
        return null;
    }
}

async function handleCompletionRequest(request: CompletionRequest){
    const appSettings = fetchAllAppSettings();
    console.log(appSettings);
    let connectionid = request.connectionid;
    if(!connectionid){
        connectionid = appSettings?.defaultConnection ?? "";
    }
    if(!connectionid){
        return null;
    }
    const modelInfo = fetchConnectionById(connectionid) as GenericCompletionConnectionTemplate;
    if(!modelInfo){
        return null;
    }
    let settingsid = request.settingsid;
    if(!settingsid){
        settingsid = appSettings?.defaultSettings ?? "";
    }
    if(!settingsid){
        return null;
    }
    switch(modelInfo.type){
        case 'Mancer':
            return await getMancerCompletion(request);
        default:
            return await getGenericCompletion(request);
    }
}

llmsRouter.post('/completions', authenticateToken, async (req, res) => {
    const request = req.body as CompletionRequest;
    const response = await handleCompletionRequest(request);
    res.send(response);
});