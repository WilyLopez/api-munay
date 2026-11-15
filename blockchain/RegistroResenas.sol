pragma solidity ^0.8.24;

contract RegistroResenas {
    address public immutable firmante;
    mapping(bytes32 => bool) public registrada;

    event ResenaRegistrada(bytes32 indexed huella);
    error FirmanteNoAutorizado();
    error HuellaVacia();

    constructor(address cuenta) {
        if (cuenta == address(0)) revert FirmanteNoAutorizado();
        firmante = cuenta;
    }

    function registrar(bytes32 huella) external {
        if (msg.sender != firmante) revert FirmanteNoAutorizado();
        if (huella == bytes32(0)) revert HuellaVacia();
        if (registrada[huella]) return;
        registrada[huella] = true;
        emit ResenaRegistrada(huella);
    }
}
