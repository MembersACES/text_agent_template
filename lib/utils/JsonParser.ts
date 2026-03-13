/**
 * Shared JSON extraction and parsing utilities
 * Handles extraction of JSON from LLM responses with fallback parsing
 */

/**
 * Extract JSON from a text response that may contain JSON code blocks
 * Returns an array of parsed JSON objects/arrays
 */
export function extractJsonFromResponse(text: string): any[] {
    const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
    const jsonBlockMatches = [...text.matchAll(jsonBlockRegex)];

    if (jsonBlockMatches.length === 0) {
        return [];
    }

    const parsedBlocks = jsonBlockMatches
        .map(match => {
            try {
                let jsonContent = match[1].trim();

                // If content doesn't start with { or [, try to find JSON within the content
                if (!jsonContent.startsWith('{') && !jsonContent.startsWith('[')) {
                    const jsonObjectMatch = jsonContent.match(/\{[\s\S]*\}/);
                    const jsonArrayMatch = jsonContent.match(/\[[\s\S]*\]/);

                    if (jsonObjectMatch) {
                        jsonContent = jsonObjectMatch[0];
                    } else if (jsonArrayMatch) {
                        jsonContent = jsonArrayMatch[0];
                    } else {
                        return null;
                    }
                }

                // Try to parse, but if it fails, try to extract just the JSON part
                try {
                    return JSON.parse(jsonContent);
                } catch (parseError) {
                    // If parsing fails, try to find the actual JSON boundaries
                    // Look for the first { or [ and find its matching closing brace/bracket
                    const startChar = jsonContent[0];
                    const endChar = startChar === '{' ? '}' : ']';

                    let depth = 0;
                    let jsonStart = -1;
                    let jsonEnd = -1;

                    for (let i = 0; i < jsonContent.length; i++) {
                        if (jsonContent[i] === startChar) {
                            if (jsonStart === -1) jsonStart = i;
                            depth++;
                        } else if (jsonContent[i] === endChar) {
                            depth--;
                            if (depth === 0 && jsonStart !== -1) {
                                jsonEnd = i;
                                break;
                            }
                        }
                    }

                    if (jsonStart !== -1 && jsonEnd !== -1) {
                        const extractedJson = jsonContent.substring(jsonStart, jsonEnd + 1);
                        return JSON.parse(extractedJson);
                    }

                    throw parseError;
                }
            } catch (e) {
                console.error('Failed to parse JSON block:', e);
                return null;
            }
        })
        .filter(block => block !== null);

    if (parsedBlocks.length === 0) {
        return [];
    }

    // If only one block, return it as a single object (backward compatible)
    // If multiple blocks, return as array
    return parsedBlocks.length === 1
        ? (Array.isArray(parsedBlocks[0]) ? parsedBlocks[0] : [parsedBlocks[0]])
        : parsedBlocks;
}

