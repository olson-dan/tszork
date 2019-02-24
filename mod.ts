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


function toPaddedHex(n: number, padding: number) {
    let x = n.toString(16);
    while (x.length < padding) {
        x = "0" + x;
    }
    return x;
}

function u16(x: number) {
    if (x < 0) {
        return x + 65536;
    }
    return x;
}

function i16(x: number) {
    if (x > 32767) {
        return x - 65536;
    }
    return x;
}

class Frame {
    addr: number;
    stack_start: number;
    num_locals: number;
    return_storage: Return;
    return_addr: number;
}

class Memory {
    memory: Uint8Array;
    stack: Array<number>;
    frames: Array<Frame>;

    constructor(data: Uint8Array) {
        this.memory = data;
        this.stack = [];
        this.frames = [];
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
    constructor(type: OperandType, value: number) {
        this.type = type;
        this.value = value;
    }
    display() {
        switch (this.type) {
            case OperandType.Large:
                return "#" + toPaddedHex(this.value, 4);
            case OperandType.Small:
                return "#" + toPaddedHex(this.value, 2);
            case OperandType.Variable:
                if (this.value == 0) {
                    return "(SP)+";
                } else if (this.value > 0x10) {
                    return "G" + toPaddedHex(this.value - 0x10, 2);
                } else {
                    return "L" + toPaddedHex(this.value - 1, 2);
                }
            case OperandType.Indirect:
                if (this.value == 0) {
                    return "[(SP)]";
                } else if (this.value > 0x10) {
                    return "[G" + toPaddedHex(this.value - 0x10, 2) + "]";
                } else {
                    return "[L" + toPaddedHex(this.value - 1, 2) + "]";
                }
            case OperandType.Omitted:
                return "";
        }
    }
}

class Return {
    type: RetType;
    value: number;
    constructor(type: RetType, value: number) {
        this.type = type;
        this.value = value;
    }
    display() {
        switch (this.type) {
            case RetType.Variable:
                if (this.value == 0) {
                    return " -> -(SP)";
                } else if (this.value > 0x10) {
                    return " -> G" + toPaddedHex(this.value - 0x10, 2);
                } else {
                    return " -> L" + toPaddedHex(this.value - 1, 2);
                }
            case RetType.Indirect:
                if (this.value == 0) {
                    return " -> (SP)";
                } else if (this.value > 0x10) {
                    return " -> G" + toPaddedHex(this.value - 0x10, 2);
                } else {
                    return " -> L" + toPaddedHex(this.value - 1, 2);
                }
            case RetType.Omitted:
                return "";
        }
    }
}

enum ZStringShift { Zero, One, Two }

class ZString {
    offset: number;
    length: number;
    contents: string;
    constructor(mem: Memory, offset: number, max_length?: number) {
        let length = 0;
        let bytes = [];
        while (true) {
            if (max_length == length) {
                break;
            }
            let x = mem.read_u16(offset + length);
            length += 2;

            bytes.push((x >> 10) & 0x1f);
            bytes.push((x >> 5) & 0x1f);
            bytes.push(x & 0x1f);

            if ((x & 0x8000) != 0) {
                break;
            }
        }
        this.with_bytes(mem, offset, length, new Uint8Array(bytes));
    }
    with_bytes(mem: Memory, offset: number, length: number, bytes: Uint8Array) {
        let shift = ZStringShift.Zero;
        let contents = "";
        let skip_count = 0;
        bytes.forEach(function (c, i) {
            if (skip_count != 0) {
                skip_count -= 1;
                return;
            }
            switch (c) {
                case 0:
                    contents += " ";
                    break;
                case 1:
                case 2:
                case 3:
                    skip_count = 1; // skip abbrev
                    let abbrev_idx = bytes[i + 1];
                    let table = mem.read_u16(0x18);
                    let index = 32 * (c - 1) + abbrev_idx;
                    let table_ofs = mem.read_u16(table + index * 2);
                    let abbrev = new ZString(mem, table_ofs * 2);
                    contents += abbrev.contents;
                    break;
                case 4:
                    shift = ZStringShift.One;
                    break;
                case 5:
                    shift = ZStringShift.Two;
                    break;
                default:
                    if (shift == ZStringShift.Two && c == 6) {
                        skip_count = 2;
                        let char = bytes[i + 1] << 5;
                        char |= bytes[i + 2] & 0x1f;
                        contents += String.fromCharCode(char);
                    } else {
                        switch (shift) {
                            case ZStringShift.Zero:
                                contents += "______abcdefghijklmnopqrstuvwxyz"[c];
                                break;
                            case ZStringShift.One:
                                contents += "______ABCDEFGHIJKLMNOPQRSTUVWXYZ"[c];
                                break;
                            case ZStringShift.Two:
                                contents += "______^\n0123456789.,!?_#\'\"/\\-:()"[c];
                                break;
                        }
                    }
                    shift = ZStringShift.Zero;
                    break;
            }
        });
        this.offset = offset;
        this.length = length;
        this.contents = contents;
    }
}


class Instruction {
    constructor(mem: Memory, ip: number) {
        const op = mem.read_u8(ip);
        switch ((op & 0xc0) >> 6) {
            case 3: this.decode_var(mem, ip, op); break;
            case 2: this.decode_short(mem, ip, op); break;
            default: this.decode_long(mem, ip, op); break;
        }
        this.name = opnames[this.optype][this.opcode];
        if (this.name == undefined) {
            this.name = "unknown";
        }
        this.add_return(mem);
        this.add_branch(mem);
        this.add_print(mem);
    }

    decode_short(mem: Memory, ip: number, op: number) {
        this.offset = ip;
        this.opcode = op & 0xf;
        this.args = [];
        switch ((op & 0x30) >> 4) {
            case 3:
                this.optype = Encoding.Op0;
                this.length = 1;
                break;
            case 2:
                this.optype = Encoding.Op1;
                this.length = 2;
                this.args[0] = new Operand(OperandType.Variable, mem.read_u8(ip + 1));
                break;
            case 1:
                this.optype = Encoding.Op1;
                this.length = 2;
                this.args[0] = new Operand(OperandType.Small, mem.read_u8(ip + 1));
                break;
            default:
                this.optype = Encoding.Op1;
                this.length = 3;
                this.args[0] = new Operand(OperandType.Large, mem.read_u16(ip + 1));
                break;
        }
    }
    decode_long(mem: Memory, ip: number, op: number) {
        const x = mem.read_u8(ip + 1);
        const y = mem.read_u8(ip + 2);
        this.offset = ip;
        this.opcode = op & 0x1f;
        this.optype = Encoding.Op2;
        this.length = 3;
        this.args = [];
        if ((op & 0x40) != 0) {
            this.args[0] = new Operand(OperandType.Variable, x);
        } else {
            this.args[0] = new Operand(OperandType.Small, x);
        }
        if ((op & 0x20) != 0) {
            this.args[1] = new Operand(OperandType.Variable, y);
        } else {
            this.args[1] = new Operand(OperandType.Small, y);
        }
    }
    decode_var(mem: Memory, ip: number, op: number) {
        const optypes = mem.read_u8(ip + 1);
        let size = 2;
        let args: Array<Operand> = [];
        [0, 1, 2, 3].forEach(x => {
            let shift = (3 - x) * 2;
            let mask = 3 << shift;
            switch ((optypes & mask) >> shift) {
                case 3:
                    args[x] = new Operand(OperandType.Omitted, 0);
                    break;
                case 2:
                    size += 1;
                    args[x] = new Operand(OperandType.Variable, mem.read_u8(ip + size - 1));
                    break;
                case 1:
                    size += 1;
                    args[x] = new Operand(OperandType.Small, mem.read_u8(ip + size - 1));
                    break;
                default:
                    size += 2;
                    args[x] = new Operand(OperandType.Large, mem.read_u16(ip + size - 2));
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
        this.length = size;
    }

    add_return(mem: Memory) {
        this.ret = new Return(RetType.Omitted, 0);
        switch (this.optype) {
            case Encoding.Op2:
                if ((this.opcode >= 0x08 && this.opcode <= 0x09)
                    || (this.opcode >= 0x0f && this.opcode <= 0x19)) {
                    this.ret = new Return(RetType.Variable, mem.read_u8(this.offset + this.length));
                    this.length += 1;
                }
                break;
            case Encoding.Op1:
                if ((this.opcode >= 0x01 && this.opcode <= 0x04)
                    || this.opcode == 0x08
                    || (this.opcode >= 0x0e && this.opcode <= 0x0f)) {
                    this.ret = new Return(RetType.Variable, mem.read_u8(this.offset + this.length));
                    this.length += 1;
                }
                break;
            case Encoding.Var:
                if (this.opcode == 0x0 || this.opcode == 0x7) {
                    this.ret = new Return(RetType.Variable, mem.read_u8(this.offset + this.length));
                    this.length += 1;
                }
                break;
            default:
                break;
        }
    }
    add_branch(mem: Memory) {
        let branches = false;
        switch (this.optype) {
            case Encoding.Op2:
                if ((this.opcode >= 1 && this.opcode <= 7) || this.opcode == 10) {
                    branches = true;
                }
                break;
            case Encoding.Op1:
                if (this.opcode <= 2) {
                    branches = true;
                }
                break;
            case Encoding.Op0:
                if (this.opcode == 5 || this.opcode == 6 || this.opcode == 0xd || this.opcode == 0xf) {
                    branches = true;
                }
                break;
            default: break;
        }
        if (branches) {
            const branch1 = mem.read_u8(this.offset + this.length);
            let offset = (0x80 & branch1) << 8;
            let len = 0;
            if (branch1 & 0x40) {
                offset |= (branch1 & 0x3f);
                len = 1;
            } else {
                const branch2 = mem.read_u8(this.offset + this.length + 1);
                offset |= (branch1 & 0x1f) << 8;
                offset |= branch2;
                len = 2;
            }
            const compare = (offset & 0x8000) != 0;
            offset = offset & 0x7fff;
            if (offset > 0x0fff) {
                offset = -(0x1fff - offset + 1);
            }
            this.jump_offset = offset;
            this.length += len;
            this.compare = compare;
        } else {
            this.jump_offset = undefined;
            this.compare = undefined;
        }
    }
    add_print(mem: Memory) {
        if (this.optype == Encoding.Op0 && (this.opcode == 2 || this.opcode == 3)) {
            this.string = new ZString(mem, this.offset + this.length);
            this.length += this.string.length;
        } else {
            this.string = undefined;
        }
    }
    display() {
        const args = this.args.map(x => x.display()).join(",");
        const offset = toPaddedHex(this.offset, 8).toUpperCase();
        const name = this.name.toUpperCase();
        const ret = this.ret.display();
        let out = `[${offset}] ${name}\t${args}${ret}`;
        if (this.compare != undefined) {
            out += " [" + this.compare.toString().toUpperCase() + "]";
        }
        if (this.jump_offset != undefined) {
            switch (this.jump_offset) {
                case 0:
                    out += " RFALSE";
                    break;
                case 1:
                    out += " RTRUE";
                    break;
                default: {
                    const jump_offset = this.offset + this.length + this.jump_offset - 2;
                    out += " " + toPaddedHex(jump_offset, 8).toUpperCase();
                }

            }
        }
        if (this.string != undefined) {
            out += " \"" + this.string.contents + "\"";
        }
        return out;
    }
    args: Array<Operand>;
    offset: number;
    opcode: number;
    optype: Encoding;
    name: string;
    length: number;
    ret: Return;
    jump_offset: number | undefined;
    compare: boolean | undefined;
    string: ZString | undefined;
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
            let instruction = new Instruction(this.memory, this.ip);
            this.execute(instruction);
        }
    }

    execute(i: Instruction) {
        //console.log(i.display());
        const ip = this.ip;
        switch (i.name) {
            case "call": this.call(i); break;;
            case "store": {
                const [x, y] = i.args.map(x => this.read_var(x));
                this.write_var(new Return(RetType.Indirect, x), y);
                break;
            }
            case "print": IO.output(i.string.contents); break;
            case "print_paddr": {
                const [x] = i.args.map(x => x.value);
                const paddr = this.header.dynamic_start + 2 * x
                const s = new ZString(this.memory, paddr);
                IO.output(s.contents);
                break;
            }
            case "inc": {
                const [x] = i.args.map(x => this.read_direct(x));
                const old = this.read_var(new Operand(OperandType.Variable, x));
                const inc = u16((i16(old) + 1) % 0x10000);
                this.write_var(new Return(RetType.Variable, x), inc);
                break;
            }
            case "rtrue": this.ret(1); break;
            case "rfalse": this.ret(0); break;
            case "jz": {
                const [x] = i.args.map(x => this.read_var(x));
                this.jump(i, x == 0);
                break;
            }
            case "print_num": {
                const [x] = i.args.map(x => i16(this.read_var(x)));
                IO.output(x.toString());
                break;
            }
            case "add": {
                const [x, y] = i.args.map(x => i16(this.read_var(x)));
                this.write_var(i.ret, u16((x + y) % 0x10000));
                break;
            }
            case "je": {
                const [x] = i.args.map(x => this.read_var(x));
                const compare = i.args.slice(1).some(b => x == this.read_var(b));
                this.jump(i, compare);
                break;
            }
            case "jump": {
                const [x] = i.args.map(x => i16(this.read_var(x)));
                this.ip = u16(this.ip + i.length + x - 2);
                break;
            }
            case "jg": {
                const [x, y] = i.args.map(x => i16(this.read_var(x)));
                this.jump(i, x > y);
                break;
            }
            case "jl": {
                const [x, y] = i.args.map(x => i16(this.read_var(x)));
                this.jump(i, x < y);
                break;
            }
            case "push": {
                const [x] = i.args.map(x => this.read_var(x));
                this.write_var(new Return(RetType.Variable, 0), x);
                break;
            }
            case "pop": {
                this.read_var(new Operand(OperandType.Variable, 0));
                break;
            }
            case "pull": {
                const [x] = i.args.map(x => this.read_direct(x));
                const val = this.read_var(new Operand(OperandType.Variable, 0));
                this.write_var(new Return(RetType.Indirect, x), val);
                break;
            }
            case "load": {
                const [x] = i.args.map(x => this.read_direct(x));
                const val = this.read_var(new Operand(OperandType.Indirect, x));
                this.write_var(i.ret, val);
                break;
            }
            case "dec": {
                const [x] = i.args.map(x => this.read_direct(x));
                const old = this.read_var(new Operand(OperandType.Variable, x));
                const dec = u16((i16(old) - 1) % 0x10000);
                this.write_var(new Return(RetType.Variable, x), dec);
                break;
            }
            case "dec_chk": {
                const x = this.read_direct(i.args[0]);
                const y = i16(this.read_var(i.args[1]));
                const old = i16(this.read_var(new Operand(OperandType.Variable, x)));
                const dec = old - 1;
                this.write_var(new Return(RetType.Variable, x), u16(dec));
                this.jump(i, dec < y);
                break;
            }
            case "inc_chk": {
                const x = this.read_direct(i.args[0]);
                const y = i16(this.read_var(i.args[1]));
                const old = i16(this.read_var(new Operand(OperandType.Variable, x)));
                const inc = old + 1;
                this.write_var(new Return(RetType.Variable, x), u16(inc));
                this.jump(i, inc > y);
                break;
            }
            default:
                console.log(`Unknown instruction "${i.name}"`)
                this.finished = true;
        }
        if (this.ip == ip) {
            this.ip += i.length;
        }
    }

    write_local(v: number, val: number) {
        if (this.memory.frames.length > 0) {
            const frame = this.memory.frames[this.memory.frames.length - 1];
            const index = frame.stack_start + v;
            this.memory.stack[index] = val;
        }
    }

    write_global(v: number, val: number) {
        const offset = this.header.globals + this.header.dynamic_start + v * 2;
        return this.memory.write_u16(offset, val);
    }

    write_var(v: Return, val: number) {
        if (v.type == RetType.Variable || v.type == RetType.Indirect) {
            if (v.value >= 0x10) {
                this.write_global(v.value - 0x10, val);
            } else if (v.value == 0) {
                if (v.type == RetType.Indirect) {
                } else {
                    this.memory.stack.push(val);
                }
            } else {
                this.write_local(v.value - 1, val);
            }
        }
    }

    read_local(v: number) {
        if (this.memory.frames.length > 0) {
            const frame = this.memory.frames[this.memory.frames.length - 1];
            const index = frame.stack_start + v;
            return this.memory.stack[index];
        } else {
            return 0;
        }
    }

    read_global(v: number) {
        const offset = this.header.globals + this.header.dynamic_start + v * 2;
        return this.memory.read_u16(offset);
    }

    read_var(v: Operand) {
        if (v.type == OperandType.Variable || v.type == OperandType.Indirect) {
            if (v.value >= 0x10) {
                return this.read_global(v.value - 0x10);
            } else if (v.value == 0) {
                if (v.type == OperandType.Indirect) {
                    return this.memory.stack[this.memory.stack.length - 1];
                } else {
                    return this.memory.stack.pop();
                }
            } else {
                return this.read_local(v.value - 1);
            }
        } else {
            return v.value
        }
    }

    read_direct(v: Operand) {
        return this.read_var(v);
    }

    call(i: Instruction) {
        const addr = this.header.dynamic_start + this.read_var(i.args[0]) * 2;
        const ret_addr = this.ip + i.length;
        const args = i.args.slice(1).map(x => this.read_var(x));
        if (addr - this.header.dynamic_start == 0) {
            this.write_var(i.ret, 0);
            this.ip = ret_addr;
        } else {
            const num_locals = this.memory.read_u8(addr);
            this.memory.frames.push({
                addr: addr,
                stack_start: this.memory.stack.length,
                num_locals: num_locals,
                return_storage: i.ret,
                return_addr: ret_addr,
            });
            const range = [...Array(num_locals).keys()];
            range.forEach(arg => {
                if (arg < args.length) {
                    this.memory.stack.push(args[arg]);
                } else {
                    const x = this.memory.read_u16(addr + 1 + arg * 2);
                    this.memory.stack.push(x);
                }
            });
            this.ip = addr + 1 + num_locals * 2;
        }
    }

    ret(val: number) {
        const frame = this.memory.frames.pop();
        while (this.memory.stack.length != frame.stack_start) {
            this.memory.stack.pop();
        }
        this.write_var(frame.return_storage, val);
        this.ip = frame.return_addr;
    }

    jump(i: Instruction, compare: boolean) {
        if (compare == i.compare) {
            switch (i.jump_offset) {
                case 0: this.ret(0); break;
                case 1: this.ret(1); break;
                default:
                    const offset = i.offset + i.length + i.jump_offset - 2;
                    this.ip = u16(offset);
                    break;

            }
        }
    }
}
namespace IO {
    export function output(s: string) {
        let arr = new Uint8Array(s.length);
        for (var i = 0, j = s.length; i < j; ++i) {
            arr[i] = s.charCodeAt(i);
        }
        Deno.stdout.write(arr);
    }
    export function input() {
        return "";
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