// This is a test file for the transpiler
// It will always check in this order
// 1. Predefined tokens
//   - var <variable name> -> create a variable
//   - var <variable name> = <value> -> create a variable with a value
//   - if <condition> -> if statement
//     - if x > <value> -> if x is greater than the value
//     - if x < <value> -> if x is less than the value
//     - if x == <value> -> if x is equal to the value
//     - if x != <value> -> if x is not equal to the value
//     - if x >= <value> -> if x is greater than or equal to the value
//     - if x <= <value> -> if x is less than or equal to the value
//   - else -> else statement, must be paired with an if statement
// 2. Variable Operations
//   - <variable name> += <value> -> add to a variable
//   - <variable name> -= <value> -> subtract from a variable
//   - <variable name> = <value> -> set a variable to a value
export const transpile = (input) => {
    const variables = new Set();
    const output = [];
    // Track if statements for parsing
    let if_counter = 0;
    // Split the input into lines
    // Each newline is a new command
    const lines = input.split('\n').map(line => line.trim()).filter(Boolean);
    // Loop through each line
    let line_index = 0;
    for (const line of lines) {
        line_index++;
        // Tokenize the line
        const tokens = line.split(' ').map(word => word.trim());
        // Skip empty lines and comments
        if (tokens.length === 0 || (line[0] === '/' && line[1] === '/')) {
            continue;
        }
        // remove '//' and everything after it
        const commentIndex = tokens.indexOf('//');
        if (commentIndex !== -1) {
            tokens.splice(commentIndex);
        }
        // Check if the line is a variable declaration
        // var x = 1
        if (tokens[0] === 'var') {
            // Must have 2 or 4 tokens
            if (tokens.length !== 2 && tokens.length !== 4) {
                throw new Error('Invalid syntax on line ' + line_index + '.\nLine: ' + line + '\nExpected: var <variable name> or var <variable name> = <value>');
            }
            // Create the scoreboard to store variables
            if (variables.size === 0) {
                output.push(`scoreboard objectives add variables dummy`);
            }
            // Check if the variable already exists
            if (variables.has(tokens[1])) {
                throw new Error('Invalid syntax on line ' + line_index + '.\nLine: ' + line + '\nVariable ' + tokens[1] + ' already exists.');
            }
            // Track the variable internally
            variables.add(tokens[1]);
            // Check if there's a value provided
            if (tokens[3]) {
                output.push(`scoreboard players set $${tokens[1]} variables ${tokens[3]}`);
            }
            continue;
        }
        // Check if the line is an if statement
        // if x > 5
        if (tokens[0] === 'if') {
            if (tokens.length !== 4) {
                throw new Error('Invalid syntax on line ' + line_index + '.\nLine: ' + line + '\nExpected: if <variable> <operator> <value>');
            }
            // Check if the first token is a variable
            if (!variables.has(tokens[1])) {
                throw new Error('Invalid syntax on line ' + line_index + '.\nLine: ' + line + '\nVariable ' + tokens[1] + ' does not exist.');
            }
            // Check if the comparison is a variable or a number
            let is_number = false;
            let is_variable = false;
            if (!isNaN(Number(tokens[3]))) {
                is_number = true;
            }
            else {
                is_variable = true;
                // Check if the variable exists
                if (!variables.has(tokens[3])) {
                    throw new Error('Invalid syntax on line ' + line_index + '.\nLine: ' + line + '\nVariable ' + tokens[3] + ' does not exist.');
                }
            }
            // Check what the operator is
            if (is_number) {
                let value = Number(tokens[3]);
                if (tokens[2] === '>') {
                    value += 1;
                    output.push(`execute if score $${tokens[1]} variables matches ${value}..`);
                }
                else if (tokens[2] === '<') {
                    value -= 1;
                    output.push(`execute if score $${tokens[1]} variables matches ..${value}`);
                }
                else if (tokens[2] === '==') {
                    output.push(`execute if score $${tokens[1]} variables matches ${value}`);
                }
                else if (tokens[2] === '!=') {
                    const higher = value + 1;
                    const lower = value - 1;
                    output.push(`execute if score $${tokens[1]} variables matches ..${lower} if score $${tokens[1]} variables matches ${higher}..`);
                }
                else if (tokens[2] === '>=') {
                    output.push(`execute if score $${tokens[1]} variables matches ${value}..`);
                }
                else if (tokens[2] === '<=') {
                    output.push(`execute if score $${tokens[1]} variables matches ..${value}`);
                }
            }
            else if (is_variable) {
                if (tokens[2] === '>') {
                    output.push(`execute if score $${tokens[1]} variables > $${tokens[3]} variables`);
                }
                else if (tokens[2] === '<') {
                    output.push(`execute if score $${tokens[1]} variables < $${tokens[3]} variables`);
                }
                else if (tokens[2] === '==') {
                    output.push(`execute if score $${tokens[1]} variables = $${tokens[3]} variables`);
                }
                else if (tokens[2] === '!=') {
                    output.push(`execute unless score $${tokens[1]} variables = $${tokens[3]} variables`);
                }
                else if (tokens[2] === '>=') {
                    output.push(`execute if score $${tokens[1]} variables >= $${tokens[3]} variables`);
                }
                else if (tokens[2] === '<=') {
                    output.push(`execute if score $${tokens[1]} variables <= $${tokens[3]} variables`);
                }
            }
            continue;
        }
        // Check if the line is a variable
        // x += 2
        if (variables.has(tokens[0])) {
            // Must have 3 tokens
            if (tokens.length !== 3) {
                throw new Error('Invalid syntax on line: ' + line);
            }
            // Check what the operator is
            if (tokens[1] === '+=') {
                output.push(`scoreboard players add $${tokens[0]} variables ${tokens[2]}`);
            }
            else if (tokens[1] === '-=') {
                output.push(`scoreboard players remove $${tokens[0]} variables ${tokens[2]}`);
            }
            else if (tokens[1] === '=') {
                output.push(`scoreboard players set $${tokens[0]} variables ${tokens[2]}`);
            }
            continue;
        }
        // Generic error message
        throw new Error('Invalid syntax on line ' + line_index + '.\nLine: ' + line + '\nUnknown command.');
    }
    return output.join('\n');
};
