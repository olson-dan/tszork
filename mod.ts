const opnames = [
    ["rtrue", "rfalse", "print", "print_ret", "no", "save",
        "restore", "restart", "ret_popped", "pop", "quit", "new_line", "show_status",
        "verify", "extended", "piracy"],
    ["jz", "get_sibling", "get_child", "get_parent",
        "get_prop_len", "inc", "dec", "print_addr", "call_1s", "remove_obj",
        "print_obj", "ret", "jump", "print_paddr", "load", "not", "call_1n"],
    ["none", "je", "jl", "jg", "dec_chk", "inc_chk", "jin", "test",
        "or", "and", "test_attr", "set_attr", "clear_attr", "store", "insert_obj",
        "loadw", "loadb", "get_prop", "get_prop_addr",
        "get_next_prop", "add", "sub", "mul", "div", "mod", "call_2s",
        "call_2n", "set_colour"],
    ["call", "storew", "storeb", "put_prop", "sread", "print_char",
        "print_num", "random", "push", "pull", "split_window",
        "set_window", "call-vs2", "erase_window", "erase_line", "set_cursor",
        "get_cursor", "set_text_style", "buffer_mode", "output_stream",
        "input_stream", "sound_effect", "read_char",
        "scan_table", "not_v4", "call_vn", "call_vn2", "tokenise",
        "encode_text", "copy_table", "print_table", "check_arg_count"]
];

class Memory {
    memory: Uint8Array;
    constructor(data: Uint8Array) {
        this.memory = data;
    }
    len() { return this.memory.length; }
    read_u8(offset: number) { return this.memory[offset]; }
    read_u16(offset: number) {
        return (this.memory[offset] << 8) | this.memory[offset + 1];
    }
    write_u8(offset: number, val: number) {
        this.memory[offset] = val & 0xff;
    }
    write_u16(offset: number, val: number) {
        this.memory[offset] = (val >> 8) & 0xff;
        this.memory[offset + 1] = val & 0xff;
    }
};

class Header {
    memory: Memory;
    dynamic_start: number;
    dynamic_end: number;
    static_start: number;
    static_end: number;
    high_start: number;
    high_end: number;
    globals: number;
    checksum: number;
    constructor(memory: Memory) {
        this.memory = memory;
        this.dynamic_start = 0;
        this.dynamic_end = memory.read_u16(0xe);
        this.static_start = this.dynamic_end;
        this.static_end = this.static_start + Math.min(0xffff, memory.len());
        this.high_start = memory.read_u16(0x4);
        this.high_end = memory.len();
        this.globals = memory.read_u16(0xc);
        this.checksum = memory.read_u16(0x1c);
    }
}

enum Encoding { Op0, Op1, Op2, Var }
enum OperandType { Large, Small, Variable, Indirect, Omitted }
enum RetType { Variable, Indirect, Omitted }

class Operand {
    type: OperandType;
    value: number;
}

class Return {
    type: RetType;
    value: number;
}

class Instruction {
    constructor(mem: Memory, ip: number) {
        const op = mem.read_u8(ip);
        switch ((op & 0xc0) >> 6) {
            case 3: this.decode_var(mem, ip, op); break;
            case 2: this.decode_short(mem, ip, op); break;
            default: this.decode_long(mem, ip, op); break;
        }
    }

    decode_short(mem: Memory, ip: number, op: number) {
    }
    decode_long(mem: Memory, ip: number, op: number) {
    }
    decode_var(mem: Memory, ip: number, op: number) {
        let optypes = mem.read_u8(ip + 1);
        let size = 2;
        let args = [];
        [0, 1, 2, 3].forEach(function (x) {
            let shift = (3 - x) * 2;
            let mask = 3 << shift;
            switch ((optypes & mask) >> shift) {
                case 3:
                    args[x] = { type: OperandType.Omitted, value: 0 };
                    break;
                case 2:
                    size += 1;
                    args[x] = {
                        type: OperandType.Variable, value: mem.read_u8(ip + size - 1)
                    };
                    break;
                case 1:
                    size += 1;
                    args[x] = {
                        type: OperandType.Small, value: mem.read_u8(ip + size - 1)
                    };
                    break;
                default:
                    size += 2;
                    args[x] = {
                        type: OperandType.Large, value: mem.read_u16(ip + size - 2)
                    };
                    break;
            }
        });
        this.args = args.filter(x => x.type != OperandType.Omitted);
        this.offset = ip;
        this.opcode = (op & 0x1f);
        if ((op & 0x20) != 0) {
            this.optype = Encoding.Var;
        } else {
            this.optype = Encoding.Op2;
        }
        this.name = opnames[this.optype][this.opcode];
        this.length = size;
        this.ret = { type: RetType.Omitted, value: 0 };
    }
    args: Array<Operand>;
    offset: number;
    opcode: number;
    optype: Encoding;
    name: string;
    length: number;
    ret: Return;
}

class Machine {
    memory: Memory;
    header: Header;
    ip: number;
    finished: boolean;

    constructor(memory: Memory, header: Header) {
        this.memory = memory;
        this.header = header;
        this.ip = memory.read_u16(0x6);
        this.finished = false;
    }

    run() {
        while (!this.finished) {
            let instruction = this.decode();
            this.execute(instruction);
        }
    }

    execute(instruction: Instruction) {
        console.log(instruction.name);
    }

    decode() {
        return new Instruction(this.memory, this.ip);
    }
}

if (Deno.args.length < 2) {
    console.log(`usage: ${Deno.args[0]} [filename]`);
    Deno.exit(0);
}
const filename = Deno.args[1];
let memory = new Memory(Deno.readFileSync(filename));
let header = new Header(memory);
let machine = new Machine(memory, header);
machine.run();