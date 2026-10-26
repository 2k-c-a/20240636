import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommentBody, canDeleteComment } from '../../frontend/js/comments.js';

test('댓글은 코드 포인트 기준 2,000자까지 허용하고 공백·NUL·잘못된 Unicode를 거부한다', () => {
    for (const value of ['', ' \n\t', '\u3000', '\0', '\ud800', '가'.repeat(2001), null]) assert.equal(validateCommentBody(value), false);
    for (const value of ['좋은 설명이에요', '😀'.repeat(2000), '<script>alert(1)</script>', '두 줄\n댓글']) assert.equal(validateCommentBody(value), true);
});

test('본인 댓글에만 삭제 버튼을 제공한다', () => {
    assert.equal(canDeleteComment({ author_id: 'a' }, { id: 'a' }), true);
    assert.equal(canDeleteComment({ author_id: 'a' }, { id: 'b' }), false);
    assert.equal(canDeleteComment({ author_id: 'a' }, null), false);
});
