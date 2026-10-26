-- 학습 알고리즘 확장: 기존 글을 보존하며 연결할 수 있는 알고리즘 ID만 추가한다.
-- 기존 migration 1~4를 바꾸거나 다시 적용하지 않는다. 적용 시 이 파일 전체를 한 트랜잭션으로 실행한다.
alter table public.posts drop constraint posts_algorithm_id_allowed;
alter table public.posts add constraint posts_algorithm_id_allowed
    check (algorithm_id is null or algorithm_id in (
        'bfs', 'dfs', 'binary-search', 'bubble-sort',
        'union-find', 'dijkstra', 'knapsack', 'topological-sort', 'two-pointers'
    ));
