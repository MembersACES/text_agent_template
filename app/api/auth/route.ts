import { NextResponse } from 'next/server';
import { PasswordManager } from '@/lib/services/auth/PasswordManager';

const passwordManager = new PasswordManager();

export async function POST(req: Request) {
    try {
        const { password } = await req.json();

        if (passwordManager.verify(password)) {
            return NextResponse.json({ success: true });
        } else {
            return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
        }
    } catch (error) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
