/// <reference types="Cypress" />

// --- PART 1: CREATE PR ---
    //  - Navigate to PRs
    //  - Click "Add New PR"
    //  - Fill PR details (project, items, quantities, comments)
    //  - Intercept PR creation POST
    //  - Submit PR
    //  - Extract prNumber from API response
    //  - Store prNumber in Cypress.env

    // --- PART 2: APPROVE PR ---
    //  - Navigate to PR list (or PR details if already there)
    //  - Find the created prNumber
    //  - Click it to go to PR approval page
    //  - Validate PR details
    //  - Click "Approve PR" and confirm

    // --- PART 3: ADD VENDOR QUOTES & SEND FOR PO APPROVAL ---
    //  - Navigate to "New PR Requests" (or "Requests for Quotation") tab
    //  - Find the approved prNumber
    //  - Add vendor quotes (select vendors, fill rates, select best rates)
    //  - Click "Send for Approval" and confirm

    // --- PART 4: APPROVE QUOTES & GENERATE PO ---
    //  - Navigate to "Approve PO" (or "Approve Vendor Quotes") tab in Purchase Orders
    //  - Find the prNumber
    //  - Approve quotes (select items/vendors if needed)
    //  - Intercept PO generation POST
    //  - Click "Approve" / "Generate POs" and confirm
    //  - Extract generatedPoNumber from API response
    //  - Store generatedPoNumber in Cypress.env

    // --- PART 5: VERIFY PO IN APPROVED LIST (Optional but good) ---
    //  - Navigate to "Approved PO" tab
    //  - Find generatedPoNumber in the table

    // --- PART 6: DISPATCH PO ---
    //  - Navigate to (or ensure you are on) the details page of generatedPoNumber (from Approved PO list)
    //  - Handle conditional payment terms update if "Dispatch PO" is disabled
    //  - Click "Dispatch PO" and confirm (fill dispatch details)

    // --- PART 7: UPDATE DELIVERY NOTES (PARTIAL & COMPLETE) ---
    //  - On the (now dispatched) PO details page
    //  - Click "Update DN"
    //  - Perform partial delivery (get ordered quantities, input half, save)
    //  - Click "Update DN" again
    //  - Perform complete delivery (input full original ordered quantities, save)

    // --- PART 8: VERIFY PO IN DELIVERED LIST (Final Check) ---
    //  - Navigate to "Delivered PO" tab
    //  - Find generatedPoNumber in the table.

const login_pr_end_email = Cypress.env('login_Email');
const login_pr_end_password = Cypress.env('login_Password');
const project_name = Cypress.env('project_Name') || "Wakefit GT Road";

describe('Add a procurement request to approve it --- End-to-End test flow', () => {

    beforeEach(() => {
        // Using cy.session() to preserve login between different test blocks
        // cy.session('loginSession', () => {

            //Loging In
            cy.intercept('POST', '**/api/method/login').as('loginRequest');
            cy.visit('/login');

            cy.contains('Login', {timeout: 3000}).should('be.visible');
            cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(login_pr_end_email);
            cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(login_pr_end_password);
            cy.get('[data-cy="login-button"]').should('be.visible').click();

            cy.wait('@loginRequest', {timeout: 3000}).its('response.statusCode').should('eq', 200);
            cy.url().should('include', 'localhost:8080');
            cy.contains('Modules').should('be.visible');
        // });
    });


    let prNumber;

    it('Navigates to Procurement requests page and Creates a new and normal PR', () => {

        // Setting Up Intercept Use to Fetch PR-Number
        cy.intercept(
            'POST', 
            '**/api/resource/Procurement%20Requests'
        ).as('prCreationRequest');

        cy.get('[data-cy="procurement-requests-button"]').should('be.visible').click();
        cy.get('[data-cy="procurement-requests-search-bar"]').should('be.visible');
        cy.get('[data-cy="procurement-requests-data-table"]').should('exist').within(() => {
            cy.get('thead').should('exist');
            cy.get('tbody tr').should('have.length.at.least', 1);
            cy.contains('th', '#PR').should('be.visible');
            cy.contains('th', 'Created On').should('be.visible');
        });


        cy.contains('Add New PR').should('be.visible').click();
        // cy.pause()
       
        cy.get('input').type(project_name).type('{enter}')
        // cy.pause();
        

        // creating the PR According to the Project Name
        cy.get('[data-cy="add-new-pr-normal-custom-button"]').should('be.visible').click();
        cy.get('[data-cy="add-new-pr-normal"]').should('exist').click();

        cy.get('.rounded-xl.bg-card', { timeout: 10000 }) 
        .then(($cards) => {
            const randomIndex = Math.floor(Math.random() * $cards.length);
            const selectedCard = $cards[randomIndex].textContent;
            cy.log(`Selected Work Package -> ${selectedCard}`)               
            cy.wrap($cards[randomIndex]).click();
        });

        // Function to repeat process for adding two items in the PR
        function itemAdditon(iteration) {

            cy.log(`Starting Test Iteration ${iteration}`);

            // Opening Dropdown to Select required Item
            cy.get('.css-b62m3t-container .css-1xc3v61-indicatorContainer', { timeout: 10000 })
            .should('be.visible')
            .click();

            cy.get('.css-1nmdiq5-menu [role="option"]', { timeout: 10000 })
                .should('have.length.greaterThan', 0)
                    .then(($options) => {
                        const randomIndex = Math.floor(Math.random() * $options.length);
                        const randomItemText = $options[randomIndex].textContent?.trim();
                        cy.log(`Randomly Selected Item... : ${randomItemText}`);
                        cy.wrap($options[randomIndex]).click();
                    });
   
            // Open dropdown for Selecting Make
            cy.get('.css-b62m3t-container .css-1xc3v61-indicatorContainer', { timeout: 10000})
                    .should('be.visible')
                    .click();

            // Trying to find and select "Local Make" option ( with fallback to first option selection )
            cy.get('body')
                    .then(($body) => {
                        if ($body.find(':contains("Local Make")').length > 0) {
                            cy.contains('.css-1nmdiq5-menu [role="option"]', 'Local Make')
                            .should('be.visible')
                            .click();
                        } else {
                            // Fallback for selecting first option
                            cy.get('.css-1nmdiq5-menu [role="option"]')
                                .first()
                                .click();
                        }

                    });

            cy.get('#quantity-input')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled');
    
            // Generate random number between 1-9 and type it
            const randomQuantity = Math.floor(Math.random() * 16) + 33;
            cy.get('#quantity-input')
                    .should('be.visible')
                    .clear()
                    .type(randomQuantity.toString())
                        .then(() => {
                            cy.log(`Entered Random Quantity: ${randomQuantity}`);
                        });
        
             // Array of possible PR item comments
             const itemComments = [
                "Please ensure this meets the project specifications before approval.",
                "Double-check the measurements against the technical drawings.",
                "This item requires additional safety certifications - please verify.",
                "Confirm lead time with vendor before proceeding with this item.",
                "Need clarification on the material grade for this component.",
                "This matches our quality standards - ready for procurement."
            ];
    
            // selecting and typing any random comment from the Array
            cy.get('#comment-input')
                .should('be.visible')
                .clear()
                .type(itemComments[Math.floor(Math.random() * itemAdditon.length)], {delay: 33})
                    .then(($input) => {
                        cy.log(`Entered Comment : "${$input.val()}"`);
                    });
            
            cy.contains('button', 'Add to Cart')
                .scrollIntoView()
                .should('have.class', 'bg-background')
                .and('be.visible')
                .click();

        }

        // Execute 2-3 times
        [1, 2, /** 3 */].forEach((iteration) => {
            itemAdditon(iteration);
        });

        // Clicking Submit button after adding the Required Items ->
        cy.contains('button', /Submit Request/i)
            .scrollIntoView()
            .should('have.attr', 'aria-haspopup', 'dialog')
            .and('be.visible')
            .click();

        // 1. Targetting by placeholder + classes (most stable)
        cy.get('textarea[placeholder="Add final comments (optional)..."]')
            .should('be.visible')
            .type('This is my test comment for Normal PR Addition.');

        cy.contains('button', /^Cancel$/i)
            .should('have.class', 'bg-background')
            .and('have.attr', 'type', 'button')
            .and('be.visible')
            // .click();

        cy.get('button svg.lucide-check-check')
            .parent('button')
            .should('contain', 'Confirm')
            .and('be.visible')
            .click();


        // --- Extracting PR-Number Suffix ---
        let extractedPrNumber;

        cy.wait('@prCreationRequest', { timeout: 16000})
            .then((interception) => {
                expect(interception.response?.statusCode).to.equal(200, 'Expected PR Creation to Succeed');

                // 1. Check if response body and data field exist  
                if (interception.response?.body && interception.response.body.data && interception.response.body.data.name) {
                    const fullPrName = interception.response.body.data.name;
                    cy.log(`Full PR Name from API response: ${fullPrName}`);
                    // cy.pause();

                    // 2. Split the name string by hyphens
                    const parts = fullPrName.split('-');

                    // 3. Get the last part (the suffix)
                    if (parts.length >= 3) {
                        const suffixWithZeros = parts[parts.length - 1];
                        
                        // 4. Removing leading zeros by converting to number and back to string
                        extractedPrNumber = parseInt(suffixWithZeros, 10).toString();
                        
                        cy.log(`Extracted PR Number : ---> ${extractedPrNumber}`);
                        // cy.pause();

                        // Storing in Cypress.env for other tests
                        Cypress.env('prNumber', extractedPrNumber);

                    } else {
                        cy.log('Could not extract PR Suffix: "name" field format is unexpected after splitting.');
                        throw new Error('Failed to parse PR Suffix: Unexpected format of "name" field.');
                    }
                } else {
                    cy.log('Could not extract PR Suffix: API response structure is unexpected (body, data, or name field missing).');
                    console.error('Unexpected API response structure for PR creation:', interception.response?.body);
                    throw new Error('Failed to extract PR Suffix: Unexpected API response structure.');
                }
            });

        cy.then(() => {
            const prNumber = Cypress.env('prNumber');
            if (prNumber) {
                cy.log(`Using extracted PR Suffix for further actions: ${prNumber}`);
                // cy.pause();
            } else {
                cy.log('Cannot proceed as PR Suffix was not extracted.');
            }
        });

    });


    it('Navigates to Procurement requests page And check for Newly Created PR and Approve IT', () => {

        // Navigating to Procurement Requests Page and Validates using Search-bar and Data-Table ------>
        cy.get('[data-cy="procurement-requests-button"]').should('be.visible').click();
        cy.get('[data-cy="procurement-requests-search-bar"]').should('be.visible');
        cy.get('[data-cy="procurement-requests-data-table"]').should('exist').within(() => {
            cy.get('thead').should('exist');
            cy.get('tbody tr').should('have.length.at.least', 1);
            cy.contains('th', '#PR').should('be.visible');
            cy.contains('th', 'Created On').should('be.visible');
            
        });
        
        // Base Url
        const baseUrl = Cypress.config('baseUrl');

        // PR Number
        const prNumber = Cypress.env('prNumber');
        cy.log(`PR Number for the Processing PR : ---> ${prNumber}`);
        // cy.pause();

        // Ensuring the table is visible before proceeding
        cy.get('[data-cy="procurement-requests-data-table"]').should('exist');

        cy.get('[data-cy="procurement-requests-data-table"] tbody tr').should('have.length.at.least', 1);
        

        // Finding the link containing the PR number and click it
        cy.contains('[data-cy="procurement-requests-data-table"] a', prNumber)
            .should('be.visible')
                .then(($link) => {
                    const href = $link.attr('href');
                    const expectedUrl = `${baseUrl}${decodeURIComponent(href)}`;

                    cy.wrap($link).click();

                    // Verifying that the navigation succeeded
                    cy.url().then((currentUrl) => {
                        const decodedCurrentUrl = decodeURIComponent(currentUrl);
                        expect(decodedCurrentUrl).to.include(expectedUrl);
                    });
                });
        
        // Validating correct page navigation
        cy.contains('Approve/Reject/Delete PR', { timeout: 10000 }).should('be.visible');


        // Testing all PR Actions Buttons ------>
        // Test Delete PR Button
        // cy.contains('button', 'Delete PR')
        cy.get('[data-cy="delete-pr-button"]')
            .should('be.visible')
            .and('have.class', 'border-primary')
            .click();
            cy.contains('button', 'Confirm Delete')
                .should('exist')
                .and('be.visible')
                // .click()
            cy.contains('button', 'Cancel')
                .should('exist')
                .and('be.visible')
                .click();

        // Test Reject PR Button
        // cy.contains('button', 'Reject PR')
        cy.get('[data-cy="reject-pr-button"]')
            .should('be.visible')
            .and('have.class', 'border-primary')
            .click();
            cy.contains('button', 'Confirm Rejection')
                .should('exist')
                .and('be.visible')
                // .click()
            cy.contains('button', 'Cancel')
                .should('exist')
                .and('be.visible')
                .click();

        // Test Approve PR button
        // cy.contains('button', 'Approve PR')
        cy.get('[data-cy="approve-pr-button"]')
            .should('be.visible')
            .and('not.have.class', 'border-primary')
            .and('have.class', 'bg-primary')
            .click();

            cy.contains('button', 'Confirm Approval')
                .should('exist')
                .and('be.visible')
                // .click()

            cy.contains('button', 'Cancel')
                .should('exist')
                .and('be.visible')
                .click();

            // cy.contains('PR Approved')
            //     .should('exist')
            //     .and('be.visible')


        // Validate Add Missing Products button ------> 
        cy.contains('button', 'Add Missing Products')
        .should('be.visible')
        .and('have.class', 'bg-blue-600')
        .and('not.be.disabled');
        
        // Open the modal
        cy.contains('button', 'Add Missing Products').click();
        
        // Work with the modal
        cy.get('[role="alertdialog"]')
            .should('be.visible')
            .within(() => {
            // Verify modal structure
            cy.contains('h2', 'Add Missing Product').should('be.visible');
            cy.get('button').contains('X').should('be.visible');
            cy.contains('label', 'Select Product').should('be.visible');
        

            // Selecting Product Using Updated Logic
            const allowedChars = 'abcdeghiklmnoprstvxw';
            const randomChar = allowedChars[Math.floor(Math.random() * allowedChars.length)]
            cy.get('input').first().type(randomChar).type('{enter}');
            // cy.pause();
        

            // Updated Logic for Selecting the Make
            cy.get('input').eq(1).type('t').type('{enter}');
            // cy.pause();


            // Entering the Quantity
            const randomQty = Math.floor(Math.random() * 6) + 1;
            
            cy.get('input[type="number"]')
                .should('be.visible')
                .type(String(randomQty));
            // cy.pause();
        
            // Verify dependent fields are now enabled
            cy.get('#add-item-make-select').should('not.be.disabled');
            cy.get('input[placeholder="Unit"]').should('not.be.disabled');
            cy.get('input[placeholder="Qty"]').should('not.be.disabled');

            // Test Create New Product link
            cy.contains('button', 'Create New Product')
                .should('be.visible')
                .and('have.class', 'text-blue-600');
                
            // Test Cancel button
            cy.contains('button', 'Cancel')
                .should('be.visible')
                // .click();

            // Test Cancel button
            cy.contains('button', 'Add Product')
                .should('be.visible')
                .click();

            });


            cy.contains('Item Added')
                // .should('exist')
                .and('be.visible');
            cy.log('Misssing Item Added Successfully......');
                
            cy.wait(1000); 
           
            // --- WAIT FOR MODAL TO CLOSE ---
            cy.get('[role="alertdialog"]').should('not.exist');
            cy.log('Add Missing Item Dialog Closed Properly');

                
            // Test PR Action buttons after adding missing product ------>
                // Test Delete PR button
                cy.get('[data-cy="delete-pr-button"]', { timeout: 19000 })
                    .should('be.visible')
                    .then(($button) => {
                        const isDisabled = $button.attr('disabled') ||
                                            $button.hasClass('disbled') ||
                                            $button.css('pointer-events') === 'none';

                        if(isDisabled) {
                            cy.log('Delete PR Button state:', {
                                disabledAttr: $button.attr('disabled'),
                                disabledClass: $button.hasClass('disabled'),
                                pointerEvents: $button.css('pointer-events'),
                                opacity: $button.css('opacity')
                            });
                        } else {
                            cy.wrap($button)
                                // .should('have.attr', 'disabled')
                                // .should('not.have.css', 'pointer-events', 'none')
                                .click();
                        }
                    });
                    cy.contains('button', 'Confirm Delete')
                        .should('exist')
                        .and('be.visible')
                        // .click()
                    cy.contains('button', 'Cancel')
                        .should('exist')
                        .and('be.visible')
                        .click();

            // Test Reject PR button
            cy.get('[data-cy="reject-pr-button"]', { timeout: 16000 })
                .should('be.visible')
                .then(($buttonRejectPR) => {
                    const isDisabled = $buttonRejectPR.attr('disabled') ||
                                        $buttonRejectPR.hasClass('disbled') ||
                                        $buttonRejectPR.css('pointer-events') === 'none';

                    if(isDisabled) {
                        cy.log('Reject PR Button state:', {
                            disabledAttr: $buttonRejectPR.attr('disabled'),
                            disabledClass: $buttonRejectPR.hasClass('disabled'),
                            pointerEvents: $buttonRejectPR.css('pointer-events'),
                            opacity: $buttonRejectPR.css('opacity')
                        });
                    // } else {   
                        cy.wrap($buttonRejectPR)
                            // .should('have.attr', 'disabled')
                            // .should('not.have.css', 'pointer-events', 'none')
                            .click({force: true});
                    }
                });
                cy.contains('Confirm Rejection')
                    .should('exist')
                    .and('be.visible')
                    // .click()
                cy.contains('button', 'Cancel')
                    .should('exist')
                    .and('be.visible')
                    .click();

            // Test Approve PR button
            cy.get('[data-cy="approve-pr-button"]', { timeout: 16000 })
                .should('be.visible')
                .then(($buttonApproveButton) => {
                    const isDisabled = $buttonApproveButton.attr('disabled') ||
                                    $buttonApproveButton.hasClass('disabled') ||
                                    $buttonApproveButton.css('pointer-events') === 'none';

                    if(isDisabled) {
                        cy.log('Approve PR Button state:', {
                            disabledAttr: $buttonApproveButton.attr('disabled'),
                            disabledClass: $buttonApproveButton.hasClass('disabled'),
                            pointerEvents: $buttonApproveButton.css('pointer-events'),
                            opacity: $buttonApproveButton.css('opacity')
                        });
                    // } else {
                        cy.wrap($buttonApproveButton)
                            // .should('not.have.attr', 'disabled')
                            // .should('not.have.css', 'pointer-events', 'none')
                            .click();
                    }
                });
                cy.contains('button', 'Cancel')
                    .should('exist')
                    .and('be.visible')
                    // .click();
                cy.contains('button', 'Confirm Approval')
                    .should('exist')
                    .and('be.visible')
                    .click()
                cy.contains('PR Approved')
                    .should('exist')
                    .and('be.visible')
                
                // cy.pause()

            // Logging in the PR Number which is Approved
            cy.log(`Successfully Approved the PR with PR Number as: ${prNumber}`);
    });


    it('Navigates to Procurement Requests Page, Navigates to New PR Request tab and add Vendor Quotes', () => {

        // Navigating to Procurement Requests Page
        cy.get('[data-cy="procurement-requests-button"]')
            .should('be.visible').click();

        // Validating Right Page using Search Bar
        cy.get('[data-cy="procurement-requests-search-bar"]')
            .should('be.visible');

        // Navigating to New PR Requests page/container
        cy.get('[data-cy="new-pr-request-navigation"]')
            .should('exist')
            .and('be.visible')
            .click();
        
        // Validating Data-Table 
        cy.get('[data-cy="procurement-requests-data-table"]').should('exist').within(() => {
            cy.get('thead').should('exist');
            cy.get('tbody tr').should('have.length.at.least', 1);
            cy.contains('th', '#PR').should('be.visible');
            cy.contains('th', 'Created').should('be.visible');
        });

        // Base URL
        const baseUrl = Cypress.config('baseUrl');

        // Get the PR number from Cypress environment or define directly
        const prNumber = Cypress.env('prNumber');

        // Ensuring the table is loaded and has at least one row
        cy.get('[data-cy="procurement-requests-data-table"]').should('exist');
        cy.get('[data-cy="procurement-requests-data-table"] tbody tr').should('have.length.at.least', 1);

        // Finding the link containing the PR number and click it
        cy.contains('[data-cy="procurement-requests-data-table"] a', prNumber, { timeout: 19000 })
            .should('be.visible')
                .then(($link) => {
                    const href = $link.attr('href');
                    const expectedUrl = `${baseUrl}${decodeURIComponent(href)}`;

                    // Clicking the PR link
                    cy.wrap($link).click();

                    // Verifying that the navigation succeeded
                    cy.url()
                        .then((currentUrl) => {
                            const decodedCurrentUrl = decodeURIComponent(currentUrl);
                            expect(decodedCurrentUrl).to.include(expectedUrl);
                        });
                });

        // Validating correct page navigation
        cy.contains('Summary', { timeout: 10000 }).should('be.visible');

        // Validating the 'Delete PR' button using data-cy attribute
        cy.get('[data-cy="delete-pr-procurement-vendor"]')
            .should('exist')
            .and('be.visible')
            .click();

        // Check the Heading text of the Dialog
        cy.get('[data-cy="delete-pr-procurement-vendor-dialog-text"]')
        .should('exist')
        .and('be.visible')
        .and('have.text', 'Delete Procurement Request')
        
        // Check Confirm Approval button visibility in Dialog Box
        cy.get('[data-cy="delete-pr-procurement-vendor-dialog-confirm"]')
            .should('exist')
            .and('be.visible')
            // .click();

        
        // Check Cancel button visibility in Dialog Box
        cy.get('[data-cy="delete-pr-procurement-vendor-dialog-cancel"]')
            .should('exist')
            .and('be.visible')
            .click();

        // Validating Continue Button and Clicking to navigate to Next Page
        cy.get('[data-cy="procurement-vendor-continue-button"]')
            .should('exist')
            .and('be.visible')
            .should('not.be.disabled')
            .click();

        // Selecting Vendors
        cy.get('[data-cy="vendore-quote-vendor-selection-button"]')
            .should('exist')
            .and('be.visible')
            .should('not.be.disabled')
            .click();

        // Vendor Selection Dialog --->
        // Step 1: Check for the heading
        cy.contains('[data-cy="vendor-addition-text"]', 'Add Vendors to RFQ')
            .should('exist')
            .and('be.visible');
        
        // Pick two random characters from a-y
        const characters = 'abcdefghijklmnopqrstuvwxy'.split('');
        const randomChars = Cypress._.sampleSize(characters, 2);

        // Type into dropdown input and select first visible option
        randomChars.forEach( char => {
            cy.get('[data-cy="vendor-addition-dropdown')
                .click()
                // .clear()
                .type(char);

        // Waiting for dropdown menu and then selecting the first option
        cy.get('.css-1nmdiq5-menu')
            // .siblings()
            .find('div')
            .first()
            .click();
        });

        
        
        // Validating Vendor Selection Cancel Button
        cy.get('[data-cy="vendor-selection-cancel-button"]')
            .should('exist')
            .and('be.visible')
            // .click();

        // Validating Vendor Selection Confirm Button
        cy.get('[data-cy="vendor-selection-confirm-button"]')
            .should('exist')
            .and('be.visible')
            .click();


        // Filling Vendor Quotes --->
        // Getting/Fetching all item rows
        cy.get('tbody tr')
            .then(($rows) => {
                const itemCount = $rows.length;
                cy.log(`Found ${itemCount} items to Process`);
                // Process each row sequentially
                Cypress._.times(itemCount, (rowIndex) => {
                    cy.get('tbody tr').eq(rowIndex)
                        .then(($row) => {
                            // Targetting vendor card count for this row
                            const vendorCardCount = $row.find('[data-cy="vendor-quote-rate"]').length;
                            cy.log(`Processing item ${rowIndex + 1} with ${vendorCardCount} vendors`);

                            // Process each vendor card in this row
                            Cypress._.times(vendorCardCount, (vendorIndex) => {
                                cy.get('tbody tr').eq(rowIndex)
                                    .within(() => {
                                        cy.get('[role="radio"]').eq(vendorIndex)
                                            .within(() => {

                                                // 1. Select first Make option
                                                cy.get('.css-b62m3t-container')
                                                    .click();
                                                cy.get('.css-w9q2zk-Input2')
                                                    .first()
                                                    .click();
                                            
                                                // 2. Enter random rate between 63-330
                                                const randomRate = Math.floor(Math.random() * (330 - 63 + 1)) + 1000;
                                                cy.get('[data-cy="vendor-quote-rate"]')
                                                    .clear()
                                                    .type(randomRate.toString());
                                            });
                                    });
                            });
                        });
                });
            });

        // Additional validation check for rates
        cy.get('tbody tr').each(($row) => {
            cy.wrap($row).find('[data-cy="vendor-quote-rate"]')
                .each(($rateInput) => {
                    cy.wrap($rateInput).should('not.have.value', '');
                });
        });
        

        // Navigating to View Page
        // Verify Edit becomes active and View becomes inactive
        // cy.get('[data-cy="vendor-quotes-edit-button"]')
        cy.get('[data-cy="vendor-quotes-edit-button"]')
            .scrollIntoView()
            .should('exist')
            .and('be.visible');

        cy.get('[data-cy="vendor-quotes-view-button"]')
            .scrollIntoView()
            .should('not.have.class', 'bg-red-100');

        // View Button
        cy.get('[data-cy="vendor-quotes-view-button"]')
            .should('exist')
            .and('be.visible')
            .click();

        // Updated Code for selecting Minimum Rates
        cy.get('tbody tr').each(($row) => {
            cy.wrap($row).within(() => {
              const vendorCards = [];
          
              cy.get('[role="radio"]').each(($card) => {
                cy.wrap($card).then(($el) => {
                  // Get the rate value by finding label: "Rate" and its sibling p
                  const labelEls = $el.find('label');
          
                  labelEls.each((_, label) => {
                    if (Cypress.$(label).text().trim() === 'Rate') {
                      const rateText = Cypress.$(label).next('p').text().trim();
                      const rate = parseFloat(rateText.replace(/[^0-9.]/g, ''));
                      vendorCards.push({ element: $card, rate });
                    }
                  });
                });
              }).then(() => {
                if (vendorCards.length > 0) {
                  const minRateCard = vendorCards.reduce((min, card) =>
                    card.rate < min.rate ? card : min, vendorCards[0]);
          
                  cy.wrap(minRateCard.element).click();
          
                  // Optionally verify selection if checkmark icon appears
                  cy.wrap(minRateCard.element)
                    .find('.lucide-circle-check')
                    .should('be.visible');
                }
              });
            });
          });

        
        // Revert and Continue Button
        cy.get('[data-cy="revert-pr-button"]')
          .should('exist')
          .and('be.visible')
          .click();

            // Revert PR Dialog - Box
            cy.get('[data-cy="revert-pr-dialog-text')
                .should('exist')
                .and('be.visible');
            
            // Revert PR cancel and confirm
            cy.get('[data-cy="revert-pr-dialog-confirm-button"]')
                .should('exist')
                .and('be.visible')
                // .click();

            cy.get('[data-cy="revert-pr-dialog-cancel-button"]')
                .should('exist')
                .and('be.visible')
                .click();

        // Validationg Continue Button
        cy.get('[data-cy="vendor-selection-continue-button"]')
          .should('exist')
          .and('be.visible')
          .should('not.be.disabled')
          .click();

        // Validation Vendor Selection Summary Send For Approval Button
        cy.get('[data-cy="vendor-selection-summary-send-for-approval-button"]')
          .should('exist')
          .and('be.visible')
          .should('contain.text', 'Send for Approval')
          .click();

            cy.get('[data-cy="send-for-approval-dialog-text"]')
                .should('exist')
                .and('be.visible');

                // Target the textarea using its class and placeholder
                cy.get('textarea[placeholder="type here..."].ant-input')
                    .should('be.visible')
                    .and('have.class', 'border-green-400')
                    .clear()
                    .type('This PR is sent for approval by Test - Automation flow...')
                    .should('have.value', 'This PR is sent for approval by Test - Automation flow...');

                // cy.get('[data-cy="send-for-approval-dialog-remarks-input"]')
                //     .should('exist')
                //     .and('be.visible')
                //     .clear()
                //     .type('This PR is sent for approval by Test - Automation flow');

                    cy.get('[data-cy="send-for-approval-dialog-cancel-button"]')
                        .should('exist')
                        .and('be.visible')
                        .should('contain.text', 'Cancel')
                        // .click();

                    cy.get('[data-cy="send-for-approval-dialog-confirm-button"]')
                        .should('exist')
                        .and('be.visible')
                        .should('contain.text', 'Confirm')
                        .click();
                    cy.contains('Success!')
                        .should('exist')
                        .and('be.visible');

        // Logging in the PR Number for which is Vendor Quotations are Added
        cy.log(`Successfully Added Vendor Quotations for the PR with PR Number as: ${prNumber}`);

    });


    it('Navigates to Purchase Orders and Approves the Procurement Request for which Vendor Quotations are added', () => {


        // Step 1: Validate the Purchase Orders button exists and is visible
        cy.get('[data-cy="purchase-orders-button"]')
        .should('be.visible')
        .and('contain.text', 'Purchase Orders')

        // Step 2: Clicking the button to go to the Purchase Orders page
        cy.get('[data-cy="purchase-orders-button"]')
            .click();

        // Step 3: Confirm navigation occurred
        cy.url().should('include', '/purchase-orders');
        cy.contains('PURCHASE-ORDERS')
            .should('exist')
            .and('be.visible');

        // Validating Approve PO Navigation Button is Active
        cy.get('[data-cy="approve-po-navigation"]')
            .should('be.visible')
            .closest('label')
            .should('have.class', 'ant-radio-button-wrapper-checked')
            .find('input[type="radio"]')
            .should('be.checked');

        // Search Bar Presence
        cy.get('[data-cy="procurement-requests-search-bar"]')
            .should('be.visible');

        // Data Table Presence
        cy.get('[data-cy="procurement-requests-data-table"]')
            .should('exist')
            .within(() => {
                cy.get('thead')
                    .should('exist');
                cy.get('tbody tr')
                    .should('have.length.at.least', 1);
                cy.contains('th', '#PR')
                    .should('be.visible');
                cy.contains('th', 'Created On')
                    .should('be.visible');
            });

        // Base URL
        const baseUrl = Cypress.config('baseUrl');

        // Get the PR number from Cypress environment
        const prNumber = Cypress.env('prNumber');

        // Ensuring the table is loaded and has at least one row
        cy.get('[data-cy="procurement-requests-data-table"]').should('exist');
        cy.get('[data-cy="procurement-requests-data-table"] tbody tr').should('have.length.at.least', 1);

        // Finding the link containing the PR Number and Clicking it
        cy.contains('[data-cy="procurement-requests-data-table"] a', prNumber, { timeout: 23000 })
            .should('be.visible')
                .then(($link) => {
                    const href = $link.attr('href');
                    const expectedUrl = `${baseUrl}${decodeURIComponent(href)}`;

                    // Clicking the PR Link
                    cy.wrap($link).click();

                    // Verifying that the navigation Succeeded
                    cy.url()
                        .then((currentUrl) => {
                            const decodedCurrentUrl = decodeURIComponent(currentUrl);
                            expect(decodedCurrentUrl).to.include(expectedUrl);
                        });
                });

         // Validating correct page navigation
         cy.contains(/^(Approve\/Reject Vendor Quotes|Approve\/Send Back Vendor Quotes)$/, { timeout: 10000 })
            .should('be.visible');

        // Click the Vendor Block
        cy.get('[data-cy="vendor-name-property"]')
            .should('exist')
            .and('be.visible')
            .first()
            .click( /** { force: true } */);

        // Waiting for the items table to be visible
        cy.get('[data-cy="items-name-table"] table tbody tr')
            .should('have.length.greaterThan', 0);


         // Check all unchecked checkboxes inside the table
            // First getting all vendor sections and expand them if closed
            cy.get('[data-cy="vendor-name-property"]').each(($vendor) => {
                // Check if the vendor section is closed
                cy.wrap($vendor).then(($el) => {
                const isClosed = $el.attr('data-state') === 'closed';
                
                if (isClosed) {
                    // Click the vendor header to expand it
                    cy.wrap($el).find('h3 > button').click();
                }
                
                // Wait for the content to be visible (adjust timeout if needed)
                cy.wrap($el).find('[data-cy="items-name-table"]').should('be.visible');
                
                // Now check all unchecked checkboxes in this vendor's table
                cy.wrap($el).find('[data-cy="items-name-table"] table tbody tr').each(($row) => {
                    cy.wrap($row).within(() => {
                    cy.get('button[role="checkbox"]').then(($checkbox) => {
                        const isChecked = $checkbox.attr('aria-checked') === 'true';
                        if (!isChecked) {
                        cy.wrap($checkbox).click();
                        }
                    });
                    });
                });
                });
            });

        // --- Set up the intercept for the POST request ---
        cy.log('--- Setting up intercept for generated pos ---');
        cy.intercept(
            'POST',
            '**/api/method/nirmaan_stack.api.approve_vendor_quotes.generate_pos_from_selection'
        ).as('generatePOsRequest');
        

        // Validaying Reject Button
        cy.get('[data-cy="reject-button"]')
            .should('exist')
            .and('be.visible')
            .should('not.be.disabled')
            // .click();
    
        // Validating Approve Button
        cy.get('[data-cy="approve-button"]')
            .should('exist')
            .and('be.visible')
            .should('not.be.disabled')
            .click();

        // Check the Heading text of the Dialog
        cy.get('div[role="alertdialog"] h2')
            .should('exist')
            .and('be.visible')
            .and('have.text', 'Confirm Approval?')
        
        // Check Cancel button visibility in Dialog Box
        cy.contains('button', 'Cancel')
            .should('exist')
            .and('be.visible')
            // .click();
        
        // Check Confirm Approval button visibility in Dialog Box
        cy.contains('button', 'Confirm Approval')
            .should('exist')
            .and('be.visible')
            .click();

        let generatedPoNumber;

        cy.wait('@generatePOsRequest', { timeout: 20000 })
            .then((interception) => {
                expect(interception.response?.statusCode).to.equal(200, 'Expected PO generation to succeed');
        
                // 1. Checking if the response body and the nested 'message' object and 'po' field exist
                if (interception.response?.body &&
                        interception.response.body.message &&
                        interception.response.body.message.po) {
                    
                        generatedPoNumber = interception.response.body.message.po;
                        cy.log(`Extracted Generated PO Number: ${generatedPoNumber}`);
                        cy.pause();
                
                        //Storing in Cypress.env for other tests
                        Cypress.env('latestGeneratedPoNumber', generatedPoNumber);
        
                    } else {
                        cy.log('Could not extract PO Number: API response structure is unexpected (body, message object, or po field missing).');
                        console.error('Unexpected API response structure for PO generation:', interception.response?.body);
                        throw new Error('Failed to extract PO Number: Unexpected API response structure.');
                    }
                });
        
            cy.then(() => {
                const poToVerify = Cypress.env('latestGeneratedPoNumber');
                if (poToVerify) {
                    cy.log(`Using extracted PO Number for further actions: ${poToVerify}`);
                    cy.pause();
                } else {
                    cy.log('Cannot proceed as PO Number was not extracted.');
                }
            });
   
    });


    it('Navigates to Approved PO tab and check for the approved PR', () => {

        const poNumber = Cypress.env('latestGeneratedPoNumber');
        cy.log(`PO Number to find in the Table : -> ${poNumber}`);
        cy.pause();

        // Step 1: Validating the Purchase Orders button exists and is visible
        cy.get('[data-cy="purchase-orders-button"]')
        .should('be.visible')
        .and('contain.text', 'Purchase Orders')

        // Step 2: Clicking the button to go to the Purchase Orders page
        cy.get('[data-cy="purchase-orders-button"]')
            .click();

        // Step 3: Confirm navigation occurred
        cy.url().should('include', '/purchase-orders');
        cy.contains('PURCHASE-ORDERS')
            .should('exist')
            .and('be.visible');

        cy.get('[data-cy="approved-po-navigation"]')
            .should('exist')
            .and('be.visible')
            .click();

        // Data Table Presence
            cy.get('[data-cy="procurement-requests-data-table"]', { timeout: 10000 })
            .should('exist')
            .within(() => {
                cy.get('thead')
                    .should('exist');
                cy.get('tbody tr')
                    .should('have.length.at.least', 1);
                cy.contains('th', '#PO')
                    .should('be.visible');
                cy.contains('th', 'Created On')
                    .should('be.visible');
            });

        
        // --- Searching for the extracted PO Number in the table ---
        cy.log(`Searching for PO: ${poNumber} in the table.`);
        cy.get('[data-cy="procurement-requests-data-table"] tbody', { timeout: 15000 })
            .contains('tr td:first-child a.font-medium', poNumber, { matchCase: false })
            .should('be.visible')
            .then(($link) => {
                cy.log(`Found PO: ${$link.text().trim()} in the Approved POs table.`);
                // Clicking the PO
                cy.wrap($link).click();
            });
        
        cy.log(`PO "${poNumber}" successfully found in the Approved POs table.`);

        
    });

    let poNumber;

    it('Navigates to Approved PO page, Dispatch a PO, and Update Delivery Notes', () => {

        cy.get('[data-cy="purchase-orders-button"]')
            .should('exist')
            .and('be.visible')
            .click();

        cy.get('[data-cy="approved-po-navigation"]')
            .should('exist')
            .and('be.visible')
            .click();

        cy.get('[data-cy="procurement-requests-search-bar"]')
            .should('exist')
            .and('be.visible');

        cy.get('[data-cy="procurement-requests-data-table"]')
            .should('exist')
            .and('be.visible')
            .within(() => {
                cy.get('thead')
                    .should('exist');
                cy.get('tbody tr')
                    .should('have.length.at.least', 1);
                cy.contains('th', '#PO')
                    .should('be.visible');
                cy.contains('th', 'Created On')
                    .should('be.visible');
            });

        cy.get('[data-cy="procurement-requests-data-table"] tbody tr')
            .first()
            .within(() => {
                cy.get('a[href^="/purchase-orders/"]')
                    .invoke('text')
                    .then((poNumberFromTable) => {
                        poNumber = poNumberFromTable.trim();
                        Cypress.env('poNumber', poNumber);
                        expect(poNumber).to.match(/^PO\/\d+\/\d+\/\d{2}-\d{2}$/);
                        cy.get('a[href^="/purchase-orders/"]')
                            .should('have.attr', 'href')
                            .and('include', poNumber.replace(/\//g, '&='));
                        cy.get('a[href^="/purchase-orders/"]')
                            .click();
                    });
            });

        cy.then(() => {
            const poNumberUsage = Cypress.env('poNumber') || poNumber;
            cy.log(`Extracted PO Number: ${poNumberUsage}`);
        });

        cy.get('[data-cy="po-details-request-payment-button"]')
            .should('exist')
            .and('be.visible');

        cy.get('[data-cy="po-details-request-payment-button"]')
            .should('contain.text', 'Request Payment');

        cy.get('[data-cy="po-details-dispatch-po-button"]').then(($btn) => {
            if (!$btn.is(':disabled')) {
                cy.wrap($btn)
                    .should('be.visible')
                    .and('contain.text', 'Dispatch PO')
                    .and('have.class', 'bg-primary')
                    .find('svg')
                    .should('exist')
                    .and('have.attr', 'class', 'lucide lucide-send h-4 w-4');
                cy.wrap($btn).click();
            } else {
                cy.get('[data-cy="po-details-payment-details-button"]')
                    .should('exist')
                    .contains('Payment Details')
                    .and('be.visible')
                    .click();
                cy.get('[data-cy="payment-terms-edit-button"]')
                    .should('be.visible')
                    .and('not.be.disabled')
                    .and('contain.text', 'Edit')
                    .click();
                cy.get('[data-cy="edit-payment-terms-card-heading"]')
                    .scrollIntoView()
                    .should('exist')
                    .and('be.visible')
                    .and('contain.text', 'Edit Terms and Charges');
                cy.get('button[role="combobox"]')
                    .should('be.visible')
                    .click();
                cy.get('button[role="combobox"]')
                    .then(($combobox) => {
                        const controlsId = $combobox.attr('aria-controls');
                        cy.get(`[id="${controlsId}"] [role="option"]`)
                            .first()
                            .should('be.visible')
                            .click();
                    });

                const testNotes = 'Test notes for payment terms - please process ASAP';
                
                cy.get('[data-cy="payment-terms-notes-input"]')
                    .should('exist')
                    .and('be.visible')
                    .type(testNotes, { delay: 50 });

                cy.get('[data-cy="payment-terms-save-button"]')
                    .scrollIntoView()
                    .should('exist')
                    .and('be.visible')
                    .click();
            }
        });

        cy.contains('button', 'Preview')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled');

        cy.get('[data-cy="po-details-dispatch-po-button"]')
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .click({ force: true });

        cy.get('[data-cy="po-details-mark-as-dispatched-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .and('have.text', 'Mark as Dispatched')
            .click();

        cy.get('[data-cy="mark-as-dispatched-person-name-input"]')
            .should('exist')
            .and('be.visible')
            .type('Test Person Name');

        function generateRandomPhoneNumber() {
            const randomNumber = Math.floor(1000000000 + Math.random() * 9000000000);
            return `+91${randomNumber}`;
        }

        const randomPhone = generateRandomPhoneNumber();

        cy.get('[data-cy="mark-as-dispatched-contact-number-input"]')
            .should('exist')
            .and('be.visible')
            .type(randomPhone);

        cy.get('[data-cy="mark-as-dispatched-confirm-button"]')
            .should('exist')
            .and('be.visible')
            .and('not.be.disabled')
            .click();

        cy.get('[data-cy="po-details-dd-invoice-button"]')
            .should('exist')
            .and('be.visible')
            .then(($btn) => {
                cy.wrap($btn).click({ force: true });
            });
        cy.contains('button', 'Cancel')
            .should('exist')
            .and('be.visible')
            .click();

        // cy.get('[data-cy="po-details-revert-button"]')
        //     .should('exist')
        //     .and('be.visible')
        //     .click({ force: true });

        // cy.contains('button', 'Cancel')
        //     .should('exist')
        //     .and('be.visible')
        //     .click();

        // cy.get('[data-cy="po-details-revert-button"]')
        //     .click({ force: true });
        // cy.contains('button', 'Cancel')
        //     .should('exist')
        //     .and('be.visible')
        //     .click();

        // cy.pause();


        // --- STARTING: PARTIAL DELIVERY ---
        // Update Delivery Notes Button - First Time (for partial delivery)
        cy.get('[data-cy="po-details-update-dn-button"]')
            .scrollIntoView()
            .should('exist')
            .and('be.visible')
            .click({ force: true });

        // cy.pause();


        // This array will store the ordered quantity for each item
        const itemDeliveryData = [];
        // Selector for the table body where ordered quantities are initially displayed
        const initialOrderDetailsTableBodySelector = 'div.p-0 div.overflow-y-auto table.order-details-table tbody';

        // 1. Getting ordered quantities from the Order Details table
        cy.get(initialOrderDetailsTableBodySelector)
            .find('tr')
            .each(($row, index) => {
                cy.wrap($row).find('td').eq(3).invoke('text').then((text) => {
                    const orderedQuantity = parseInt(text.trim(), 10) || 0;
                    itemDeliveryData.push({
                        originalIndex: index,
                        ordered: orderedQuantity,
                        deliveredSoFar: 0
                    });
                    cy.log(`Item ${index + 1}: Initial Ordered Quantity = ${orderedQuantity}`);
                });
            })
            .then(() => {
                // All quantities stored itemDeliveryData array
                // 2. Clicking the "Edit" button
                cy.get('[data-cy="update-dn-edit-button"]')
                    .scrollIntoView()
                    .should('be.visible')
                    .and('not.be.disabled')
                    .click();
            })
            .then(() => {
                // --- LOGIC FOR INPUTTING PARTIAL QUANTITIES ---
                cy.log('Starting partial delivery input for items:', itemDeliveryData);
                cy.wait(1500);

                // Using the global selector to find ALL required inputs
                cy.get('td:nth-child(4) input')
                    .should('have.length.at.least', itemDeliveryData.length)
                    .then($inputs => {
                        const inputsToProcess = $inputs.slice(0, itemDeliveryData.length);

                        cy.wrap(inputsToProcess).each(($inputField, index) => {
                            if (itemDeliveryData[index]) {
                                const item = itemDeliveryData[index];
                                
                                let quantityForPartialStep;
                                // Conditional Logic for Ordered Quantities as 1
                                if (item.ordered === 1){
                                    quantityForPartialStep = 0;
                                    cy.log(`Item ${index + 1} (Ordered: 1): Special case for partial delivery, inputting = ${quantityForPartialStep}`);
                                } else {
                                    quantityForPartialStep = Math.ceil(item.ordered / 2) || 0;
                                    cy.log(`Item ${index + 1} (Ordered: ${item.ordered}): Inputting partial = ${quantityForPartialStep}, expecting value: '${quantityForPartialStep.toString()}'`);

                                }

                                // const halfQuantity = Math.ceil(item.ordered / 2) || 0;
                                item.deliveredSoFar += quantityForPartialStep;

                                cy.log(`Item ${index + 1} (Ordered: ${item.ordered}): Inputting partial = ${quantityForPartialStep}`);
                                cy.wrap($inputField)
                                    .should('be.visible')
                                    .clear()
                                    .type('{selectall}{backspace}', { delay: 30 })
                                    .type(quantityForPartialStep.toString(), { delay: 50 })
                                    .should('have.value', quantityForPartialStep.toString());
                            } else {
                                cy.log(`Warning: Mismatch - No item data for input index ${index} during partial delivery.`);
                            }
                        });
                    });
            });

        // Validating Update then Cancel button (after partial input)
        cy.get('[data-cy="delivery-notes-update-button"]')
            .scrollIntoView()
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .and('contain', 'Update')
            .click();

        cy.get('[data-cy="update-dn-cancel-button"]')
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .and('contain', 'Cancel')
            .click();

        // Validating and Clicking Confirm Update for PARTIAL delivery
        cy.get('[data-cy="delivery-notes-update-button"]')
            .scrollIntoView()
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .and('contain', 'Update')
            .click();

        cy.get('[data-cy="update-dn-confirm-update-button"]')
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .and('contain', 'Confirm Update')
            .click();

        cy.log('Partial delivery submitted. Current delivery state:', itemDeliveryData);
        // --- END: PARTIAL DELIVERY ---

        cy.wait(3000);
        // --- START: COMPLETE DELIVERY ---
        cy.log('Attempting to start complete delivery.');
        cy.get('[data-cy="po-details-update-dn-button"]', { timeout: 10000 })
            .should('be.visible') 
            .and('not.be.disabled')
            .scrollIntoView()
            .click({ force: true });

        cy.get('[data-cy="update-dn-edit-button"]', { timeout: 5000 })
            .should('be.visible')
            .and('not.be.disabled')
            .scrollIntoView()
            .click();

        // // cy.get('[data-cy="po-details-update-dn-button"]'/** , { timeout: 6000 } */)
        // cy.contains('button', 'Update DN')
        // .scrollIntoView()
        // .should('exist').and('be.visible').click({ force: true});

        // cy.get('[data-cy="update-dn-edit-button"]')
        // .scrollIntoView()
        // .should('be.visible').and('not.be.disabled').click();

        cy.then(() => {
        cy.log('Starting complete delivery input for items (typing FULL ORIGINAL ordered quantity):', itemDeliveryData);
        cy.wait(1500);

        cy.get('td:nth-child(4) input')
            // .should('have.length.at.least', itemDeliveryData.length)
            .then($inputs => {
                const inputsToProcess = $inputs.slice(0, itemDeliveryData.length);

                cy.wrap(inputsToProcess).each(($inputField, index) => {
                    if (itemDeliveryData[index]) {
                        const item = itemDeliveryData[index];
                        // For the second pass FOR typing the FULL ORDERED quantity
                        const quantityToInput = item.ordered;

                        cy.log(`Item ${index + 1} (Original Ordered: ${item.ordered}): Inputting COMPLETE FULL ORDERED quantity = ${quantityToInput}, expecting value: '${quantityToInput.toString()}'`);
                        cy.wrap($inputField)
                            .should('be.visible')
                            .type('{selectall}{backspace}', { delay: 30 })
                            .type(quantityToInput.toString(), { delay: 50 })
                            .type('{del}')
                            .should('have.value', quantityToInput.toString());
                    } else {
                        cy.log(`Warning: Mismatch - No item data for input index ${index} during complete delivery.`);
                    }
                });
            });
        });

        // Validating Update and then Clicking Cancel button (for complete delivery)
        cy.get('[data-cy="delivery-notes-update-button"]')
            .scrollIntoView()
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .and('contain', 'Update')
            .click();

        cy.get('[data-cy="update-dn-cancel-button"]')
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .and('contain', 'Cancel')
            .click();

        // Validating and Clicking Confirm Update for COMPLETE delivery
        cy.get('[data-cy="delivery-notes-update-button"]')
            .scrollIntoView()
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .and('contain', 'Update')
            .click();

        cy.get('[data-cy="update-dn-confirm-update-button"]')
            .should('exist')
            .and('not.be.disabled')
            .and('be.visible')
            .and('contain', 'Confirm Update')
            .click();

        // --- END: WHEN COMPLETE DELIVERY IS DONE ---
        cy.log('Complete delivery submitted.');
        
    });

});