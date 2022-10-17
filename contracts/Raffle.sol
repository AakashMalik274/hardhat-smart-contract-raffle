//Raffle
//Enter the lottery(Paying some amount)
//Pick a random winner(verifiably random)
//Winner to be selected every X minutes -> completely automated
// Chainlink VRF - verifiable randomness, ChainLink Keepers - automation

// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.17;

//ChainLink VRF(Verifiable Random Number) Contracts
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";

//ChainLink Automation Contracts
import "@chainlink/contracts/src/v0.8/interfaces/AutomationCompatibleInterface.sol";

/*Custom Errors */
error Raffle__NotEnoughETHEntered();
error Raffle__TransferFailed();
error Raffle__NotOpen();
error Raffle__UpkeepNotNeeded(uint256 currentBalance, uint256 numPlayers, uint256 raffleState);

/**@title A sample Raffle Contract
 * @author Aakash Malik
 * @notice This contract is for creating an untamperable decentralised smart contract
 * @dev This implements ChainLink VRF v2 and Chainlink automation
 */
contract Raffle is VRFConsumerBaseV2, AutomationCompatibleInterface {
    /* Types */
    enum RaffleState {
        OPEN,
        CALCULATING
    }

    /* State Variables */
    uint256 private immutable i_entranceFee;
    address payable[] private s_players;
    VRFCoordinatorV2Interface private immutable i_vrfCoordinator;
    bytes32 private immutable i_gasLane;
    uint64 private immutable i_subscription_Id;
    uint32 private immutable i_callbackGasLimit;

    uint16 private constant REQUEST_CONFIRMATIONS = 3;
    uint32 private constant NUM_WORDS = 1;

    /* Lottery Variables */
    address payable private s_recentWinner;
    RaffleState private s_raffleState;
    uint256 private s_lastTimeStamp;
    uint256 private immutable i_interval;

    /* Events */
    event raffleEnter(address indexed player);
    event RequestedRaffleWinner(uint256 indexed requestId);
    event WinnerPicked(address indexed winner);

    /* Functions */
    constructor(
        address vrfCoordinator,
        uint256 entranceFee,
        bytes32 gasLane,
        uint64 subscription_Id,
        uint32 callbackGasLimit,
        uint256 interval
    ) VRFConsumerBaseV2(vrfCoordinator) {
        i_entranceFee = entranceFee;
        i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinator);
        i_gasLane = gasLane;
        i_subscription_Id = subscription_Id;
        i_callbackGasLimit = callbackGasLimit;
        i_interval = interval;

        s_raffleState = RaffleState.OPEN;
        s_lastTimeStamp = block.timestamp;
    }

    function enterRaffle() public payable {
        if (msg.value < i_entranceFee) {
            revert Raffle__NotEnoughETHEntered();
        }
        if (s_raffleState != RaffleState.OPEN) {
            revert Raffle__NotOpen();
        }
        s_players.push(payable(msg.sender));
        /*EVENTS
            -   Whenever we update a dynamic object, like an array or a mapping, we always want to emit
                an event, as it helps in saving gas. 

            -   EVM has a functionality called logging functionality. When things happen on a blockchain, EVM
                writes these things to it's specific data structure called its logs. 
            -   We can read these logs from our blockchain nodes that we run. Infact if we run a node or
                are connected to a node. We can make a "eth_getLogs" call to get these logs.
            -   Inside these logs is an important piece of logging information called events
            -   Event allows us to "print" stuff to logs, which is more gas efficient than actually
                saving it to something like a storage variable
                
            -   These logs and events live in a special data structure that isn't accessible to smart contracts
            
            -   Each of these events are tied to the smart-contract or contract address that emitted these 
                events in these transaction
                
                */
        /*LISTENING FOR EVENTS
            Listening for these events is extremely helpful. 
            For eg, Let's say we want to do something everytime someone calls a transfer function.
                    Instead of always reading all the variables and looking for something to flip or switch.
                    All we have to do is listen for event 
            This is how a lot of off-chain infrastructure works. When you are on a website and the website 
            reloads when a transaction completes, it actually was listening for the transaction to finish,
            listening for that event to be emitted. So that it could reload or do something else.
            
            -   It is incredibly important for front-ends
            -   It is also important for things like ChainLink and TheGraph
                
                ChainLink - In the chainLink network, a chainlink node is actually listening for request data
                            events, for it to get a random number, make an API call or etc
                
                TheGraph -  Sometimes there are way too many events, and we need to index them in a way that makes
                            sense, that you can query all these events that happen at a later date.
                            TheGraph listens for these events and stores them in the graph so that they are easy to 
                            query, later on.
                */
        /*EVENTS Syntax 
            event storedNumber(
                uint256 indexed oldNumber,
                uint256 indexed newNumber,
                uint256 addedNumber,
                address sender
            );

            It says, Hey Solidity, Hey Smart Contract, we have this new event thing, We are gonna be emitting things 
            of type storedNumber in the future. When we emit this event, it'll have four parameters.

            We can have two types of parameters in events, indexed-parameters and non-indexed parameters.

            Indexed-parameters are parameters that are much easier to search for, and much easier to query than
            non-indexed parameters.
            We can have upto 3 indexed-parameters and they are also known as topics.
            eth__getLogs function even has a parameter allowing us to search for specific topics. So it's much
            more searchable than non-indexed parameters.
            Non-Indexed ones are harder to search because they get ABI-encoded and you have to know the ABI to
            decode them.

            Non-indexed parameters cost less gas to pump into the logs.
            */
        /*Emitting Event 
            We need to actually emit that event, in order to store it to that special logging data structure 
            in EVM.
            
            emit storedNumber(
                favouriteNumber,
                _favouriteNumber,
                favouriteNumber + _favouriteNumber,
                msg.sender
            );
            */
        emit raffleEnter(msg.sender);
    }

    /**@dev checkUpkeep is used to make the contract compatible with Chainlink automation.
     * It checks if it's time to perform the Upkeep with performUpkeep function or in this case requesting winner
     * This is the function Chainlink automation nodes call
     * they look for the `upkeepNeeded` to return true
     *
     * The Following should have passed for it to be true
     * 1. Our time interval should have passed.
     * 2. Lottery should have atleast 1 player and some ETH
     * 3. Our subscription is funded with LINK
     * 4. The Lottery should be in an "open" state
     */
    function checkUpkeep(
        bytes memory /* checkData */
    )
        public
        override
        returns (
            bool upkeepNeeded,
            bytes memory /* performData */
        )
    {
        bool isOpen = (RaffleState.OPEN == s_raffleState);
        bool timePassed = ((block.timestamp - s_lastTimeStamp) > i_interval);
        bool havePlayers = (s_players.length > 0);
        bool hasBalance = (address(this).balance > 0);

        upkeepNeeded = (isOpen && timePassed && hasBalance && havePlayers);
    }

    //This function is gonna be called by ChainLink Keepers network, so it can automaticslly run
    // without us having to interact with it
    function performUpkeep(
        bytes calldata /* performData */
    ) external override {
        //1. Request the random number
        //2. Do something with it
        (bool upkeepNeeded, ) = checkUpkeep("");
        if (!upkeepNeeded) {
            revert Raffle__UpkeepNotNeeded(
                address(this).balance,
                s_players.length,
                uint256(s_raffleState)
            );
        }
        s_raffleState = RaffleState.CALCULATING;
        uint256 requestId = i_vrfCoordinator.requestRandomWords(
            i_gasLane,
            i_subscription_Id,
            REQUEST_CONFIRMATIONS,
            i_callbackGasLimit,
            NUM_WORDS
        );
        emit RequestedRaffleWinner(requestId);
    }

    function fulfillRandomWords(
        uint256, /* requestId */
        uint256[] memory randomWords
    ) internal override {
        uint256 indexOfWinner = randomWords[0] % s_players.length;
        address payable recentWinner = s_players[indexOfWinner];
        s_recentWinner = recentWinner;
        s_raffleState = RaffleState.OPEN;
        s_players = new address payable[](0);
        s_lastTimeStamp = block.timestamp;

        (bool success, ) = recentWinner.call{value: address(this).balance}("");
        if (!success) {
            revert Raffle__TransferFailed();
        }
        emit WinnerPicked(recentWinner);
    }

    /* View/Pure Functions */
    function getEntranceFee() public view returns (uint256) {
        return i_entranceFee;
    }

    function getPlayers(uint256 index) public view returns (address) {
        return s_players[index];
    }

    function getRecentWinner() public view returns (address) {
        return s_recentWinner;
    }

    function getRaffleState() public view returns (uint256) {
        return uint256(s_raffleState);
    }

    function getNumWords() public pure returns (uint32) {
        return NUM_WORDS;
    }

    function getNumberOfPlayers() public view returns (uint256) {
        return s_players.length;
    }

    function getLatestTimeStamp() public view returns (uint256) {
        return s_lastTimeStamp;
    }

    function getRequestConfirmations() public pure returns (uint16) {
        return REQUEST_CONFIRMATIONS;
    }

    function getInterval() public view returns (uint256) {
        return i_interval;
    }
}
